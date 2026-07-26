import { createFileRoute } from "@tanstack/react-router";
import { Bot, Gauge, Zap, ShieldAlert } from "lucide-react";
import { AppShell } from "@/components/creditagent/AppShell";
import { DecisionCard } from "@/components/creditagent/DecisionCard";
import { useAgentStore } from "@/lib/creditagent/store";
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
        content: "查看 AI Agent 每一次调价与预算转移的推理依据，支持人工接管与回滚。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
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

  const pending = decisions.filter((d) => d.status === "PENDING_APPROVAL");
  const holds = campaigns.filter((c) => c.status === "COMPLIANCE_HOLD").length;

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
      </header>

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
                每 15 分钟采集 Google / Meta API 与借贷 CRM 数据
              </p>
            </div>
            <span className="label-mono">{decisions.length} 条决策</span>
          </div>
          <ScrollArea className="mt-4 h-[720px] pr-3">
            <div className="space-y-3">
              {decisions.map((d) => (
                <DecisionCard key={d.id} decision={d} />
              ))}
            </div>
          </ScrollArea>
        </section>

        <section className="panel flex min-h-0 flex-col p-4">
          <div>
            <h2 className="text-sm font-semibold tracking-wide text-warning">
              人工审批队列（Human-in-the-Loop）
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              变更幅度 &gt; 30% 的决策自动挂起，等待批准或人工否决
            </p>
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
