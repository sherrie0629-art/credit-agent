import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Bot, Gauge, Zap, ShieldAlert, Brain, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/creditagent/AppShell";
import { DecisionCard } from "@/components/creditagent/DecisionCard";
import {
  BattlePlanPanel,
  toastBattlePlanResult,
} from "@/components/creditagent/BattlePlanPanel";
import {
  useAgentStore,
  agentApi,
  agentSnapshotQuery,
  prefetchQueryNonBlocking,
  refreshAgentState,
} from "@/lib/creditagent/store";
import type { BattlePlan } from "@/lib/creditagent/battle-plan";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "CreditAgent AI — 白盒 AI 投放决策指挥中心" },
      {
        name: "description",
        content:
          "消费信贷 Google/Meta 全托管投放 Agent：实时推理链、待审批决策队列与一键回滚，优化目标是实际放款成本 CPS。",
      },
      { property: "og:title", content: "CreditAgent AI — 白盒 AI 投放决策指挥中心" },
      {
        property: "og:description",
        content: "消费信贷 Google/Meta 全托管投放 Agent：实时推理链、待审批决策队列与一键回滚，优化目标是实际放款成本 CPS。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => prefetchQueryNonBlocking(context.queryClient, agentSnapshotQuery),
  component: CommandCenter,
});

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "neon",
}: {
  icon: typeof Bot;
  label: string;
  value: string;
  hint: string;
  tone?: "neon" | "success" | "warning";
}) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "neon-text";
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-muted-foreground" />
        <p className="label-mono">{label}</p>
      </div>
      <p className={`mt-2 font-mono text-2xl font-semibold ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function CommandCenter() {
  const decisions = useAgentStore((s) => s.decisions);
  const takeovers = useAgentStore((s) => s.autoTakeovers);
  const cpsImprovement = useAgentStore((s) => s.cpsImprovementPct);
  const mode = useAgentStore((s) => s.mode);
  const campaigns = useAgentStore((s) => s.campaigns);
  const loaded = useAgentStore((s) => s.loaded);
  const loadError = useAgentStore((s) => s.error);

  const [advising, setAdvising] = useState(false);
  const [planning, setPlanning] = useState(false);
  const [approvingPlan, setApprovingPlan] = useState(false);
  const [battlePlan, setBattlePlan] = useState<BattlePlan | null>(null);

  const pending = decisions.filter((d) => d.status === "PENDING_APPROVAL");
  const history = decisions.filter((d) => d.status !== "PENDING_APPROVAL");
  const holds = campaigns.filter((c) => c.status === "COMPLIANCE_HOLD").length;

  const runAdvisor = async () => {
    setAdvising(true);
    try {
      const res = await agentApi.runAdvisor();
      if (res.skipped === "KILL_SWITCH") {
        toast.warning("全局熔断开启中", { description: "分析师已跳过本轮运行" });
      } else if (!res.ok) {
        toast.error("分析师运行失败", { description: res.error ?? "请稍后重试" });
      } else if (res.created === 0) {
        toast("分析师未提出新建议", {
          description: res.summary || `净化层丢弃 ${res.dropped} 条不合规输出`,
        });
      } else {
        toast.success(`分析师提出 ${res.created} 条建议`, {
          description: "已进入人工审批队列，不会自动执行",
        });
      }
    } catch {
      toast.error("分析师运行失败", { description: "无法连接 AI 网关" });
    } finally {
      setAdvising(false);
    }
  };

  const runBattlePlan = async () => {
    setPlanning(true);
    try {
      const res = await agentApi.runBattlePlan();
      if (res.plan) setBattlePlan(res.plan);
      toastBattlePlanResult("generate", res);
    } catch (e) {
      toast.error("作战计划生成失败", {
        description: String(e instanceof Error ? e.message : e).slice(0, 160) || "无法连接服务",
      });
    } finally {
      setPlanning(false);
    }
  };

  const approveHighPriority = async () => {
    if (!battlePlan?.highPriorityIds.length) return;
    setApprovingPlan(true);
    try {
      const res = await agentApi.approveBattlePlanHighPriority(battlePlan.highPriorityIds);
      toastBattlePlanResult("approve", res);
      // 刷新计划中的状态观感：保留 plan，行上会显示已非 PENDING
      await refreshAgentState();
    } catch {
      toast.error("批量审批失败");
    } finally {
      setApprovingPlan(false);
    }
  };


  return (
    <AppShell>
      <header className="panel flex flex-wrap items-center gap-4 p-5">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <Badge className="border border-success/50 bg-success/15 text-[11px] tracking-wide text-success">
              <span className="mr-1.5 inline-block size-1.5 rounded-full bg-success pulse-dot" />
              自动托管运行中
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              托管模式：{mode === "FULL_AUTO" ? "全自动" : "半自动"} · 下次采集 04:12
            </span>
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            AI 投放决策指挥中心
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            白盒可观测决策中枢 · Google Ads &amp; Meta Ads 全托管投放
          </p>
        </div>

        <div className="ml-auto flex flex-col items-end gap-1.5">
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              size="sm"
              disabled={planning || approvingPlan}
              onClick={() => void runBattlePlan()}
              className="border border-neon/50 bg-neon/15 text-xs text-neon hover:bg-neon/25"
            >
              {planning ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Brain className="size-3.5" />
              )}
              生成今日作战计划
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={advising}
              onClick={() => void runAdvisor()}
              className="text-xs"
            >
              {advising ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Brain className="size-3.5" />
              )}
              运行 AI 分析师
            </Button>
          </div>
          <p className="max-w-[280px] text-right text-[11px] leading-snug text-muted-foreground">
            作战计划：编排已有待审（不发明动作）。分析师：追加新建议卡。执行权均在风控层。
          </p>
        </div>
      </header>

      <div className="mt-4">
        <BattlePlanPanel
          plan={battlePlan}
          decisions={decisions}
          planning={planning}
          approving={approvingPlan}
          onGenerate={() => void runBattlePlan()}
          onApproveHighPriority={() => void approveHighPriority()}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Zap}
          label="今日 AI 接管次数"
          value={String(takeovers)}
          hint="Agent 自动完成的调优操作"
        />
        <StatCard
          icon={Gauge}
          label="CPS 降幅"
          value={`−${cpsImprovement.toFixed(1)}%`}
          hint="AI 调优带来的每笔放款成本下降"
          tone="success"
        />
        <StatCard
          icon={Bot}
          label="待审批决策"
          value={String(pending.length)}
          hint="等待人工确认（Human-in-the-Loop）"
          tone="warning"
        />
        <StatCard
          icon={ShieldAlert}
          label="合规拦截"
          value={String(holds)}
          hint="合规 Agent 拦截中的广告系列"
          tone="warning"
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <section className="panel flex min-h-0 flex-col p-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold tracking-wide">
                实时决策推理流
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                已处理决策流水（待审批只在右侧队列，避免重复）
              </p>
            </div>
            <span className="label-mono">{loaded ? `${history.length} 条流水` : "加载中"}</span>
          </div>
          <ScrollArea className="mt-4 h-[720px] pr-3">
            {!loaded && loadError ? (
              <div className="rounded-md border border-dashed border-destructive/50 p-6 text-center">
                <p className="text-xs text-destructive">后端连接失败，暂时取不到决策数据</p>
                <button
                  type="button"
                  onClick={() => void refreshAgentState()}
                  className="mt-3 rounded-md border border-destructive/50 px-3 py-1 font-mono text-[11px] text-destructive transition-colors hover:bg-destructive/15"
                >
                  重试
                </button>
              </div>
            ) : !loaded ? (
              <div className="space-y-3">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="h-40 animate-pulse rounded-md border border-border bg-muted/20"
                  />
                ))}
              </div>
            ) : history.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center">
                <p className="text-xs text-muted-foreground">
                  {pending.length > 0
                    ? "暂无已处理流水；待审批请看右侧队列"
                    : "暂无决策记录"}
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((d) => (
                  <DecisionCard key={d.id} decision={d} />
                ))}
              </div>
            )}
          </ScrollArea>

        </section>

        <section className="panel flex min-h-0 flex-col p-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold tracking-wide text-warning">
                人工审批队列（Human-in-the-Loop）
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                半自动 / LLM 建议等待批决策；批准或否决后进入左侧流水
              </p>
            </div>
            <span className="label-mono text-warning">{loaded ? `${pending.length} 待批` : "—"}</span>
          </div>
          <ScrollArea className="mt-4 h-[720px] pr-3">
            {pending.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center">
                <p className="text-xs text-muted-foreground">
                  队列已清空 —— 所有决策均已处理
                </p>
              </div>

            ) : (
              <div className="space-y-3">
                {pending.map((d) => (
                  <DecisionCard key={d.id} decision={d} compact />
                ))}
              </div>
            )}
          </ScrollArea>
        </section>
      </div>
    </AppShell>
  );
}
