import { Fragment, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";

import { ChevronDown, Pause, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/creditagent/AppShell";
import { ChannelBadge } from "@/components/creditagent/badges";
import { GoogleAdsConnectionPanel } from "@/components/creditagent/GoogleAdsConnectionPanel";
import { MetaAdsConnectionPanel } from "@/components/creditagent/MetaAdsConnectionPanel";
import { StructureTab } from "@/components/creditagent/structure/StructureTab";
import { toastForExternal } from "@/lib/creditagent/google-ads";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { agentApi, useAgentStore, agentSnapshotQuery, prefetchQueryNonBlocking } from "@/lib/creditagent/store";
import type { AdGroup, BudgetPoolEntry } from "@/lib/creditagent/types";
import { cn } from "@/lib/utils";

const TABS = ["budget", "structure"] as const;
type TabKey = (typeof TABS)[number];


const POOL_REASON_LABEL: Record<string, string> = {
  RISK_PAUSE: "风控暂停释放",
  LOW_WIN_RATE: "低胜率削减",
  PACING: "节奏超速止损",
  SCALE_UP: "高胜率扩量",
  MANUAL: "人工调整",
  EXPIRED: "过期回收",
};

function poolStatusLine(pool: {
  balance: number;
  reserved: number;
  day: string;
}): string {
  if (pool.reserved > 0 && pool.balance <= 0) {
    return `已有 $${pool.reserved.toLocaleString()} 待审批冻结 · 去指挥中心队列确认`;
  }
  if (pool.balance > 0) {
    return `待再分配 $${pool.balance.toLocaleString()} · 可拨给高胜率组`;
  }
  return "今日暂无可再分配预算";
}

function timelineEntries(entries: BudgetPoolEntry[]) {
  return [...entries]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .slice(0, 10);
}

/**
 * 当日闲置预算：空池收成窄条；有余额/待批时展开并高亮。
 */
function BudgetPoolPanel({ compactEmpty = true }: { compactEmpty?: boolean }) {
  const pool = useAgentStore((s) => s.budgetPool);
  const mode = useAgentStore((s) => s.mode);
  const [running, setRunning] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [flowOpen, setFlowOpen] = useState(true);
  const [emptyExpanded, setEmptyExpanded] = useState(false);

  const timeline = useMemo(() => timelineEntries(pool.entries), [pool.entries]);
  const hasBalance = pool.balance > 0;
  const hasReserved = pool.reserved > 0;
  const isActive = hasBalance || hasReserved;
  const showFull = isActive || !compactEmpty || emptyExpanded;

  const runAllocate = async () => {
    setRunning(true);
    try {
      const res = await agentApi.runReallocation();
      if (res.skipped === "EMPTY_POOL") {
        toast("池里没有可分配余额");
      } else if (res.skipped === "NO_ELIGIBLE_RECIPIENT") {
        toast.warning("没有合格的高胜率组可承接", {
          description: "资金留在池中，当日未用将过期回收。",
        });
      } else if (res.autoExecuted) {
        toast.success(`已拨出 $${res.allocated.toLocaleString()}`, {
          description: `落到 ${res.allocations.length} 个广告组`,
        });
      } else {
        toast.success(`已生成审批卡 · $${res.allocated.toLocaleString()}`, {
          description: "半自动：请到人工审批队列确认后再改预算",
        });
      }
    } catch (e) {
      toast.error("再分配失败", { description: String(e) });
    } finally {
      setRunning(false);
    }
  };

  if (!showFull) {
    return (
      <section className="mt-4 rounded-md border border-dashed border-border/80 bg-background/30 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="label-mono">budget pool · {pool.day || "—"}</p>
            <p className="mt-1 text-xs text-muted-foreground">今日暂无闲置预算可拨</p>
          </div>
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setEmptyExpanded(true)}
          >
            查看说明与流水
          </button>
        </div>
      </section>
    );
  }

  return (
    <section
      id="budget-pool"
      className={cn(
        "panel mt-4 scroll-mt-4 p-5",
        isActive && "border-neon/40 ring-1 ring-neon/20",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label-mono">budget pool · {pool.day || "—"}</p>
          <h2 className="mt-2 text-sm font-semibold tracking-wide">当日闲置预算</h2>
          <p className="mt-1 text-xs text-muted-foreground">{poolStatusLine(pool)}</p>
          <p className="mt-1 text-[11px] text-muted-foreground">
            停组释放的预算，按通过率与 CPS 自动拨给合格组
          </p>
        </div>
        {hasBalance && (
          <div className="flex flex-col items-end gap-1">
            <Button size="sm" variant="outline" disabled={running} onClick={() => void runAllocate()}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              {running ? "拨付中…" : "拨给高胜率组"}
            </Button>
            <p className="max-w-[220px] text-right text-[10px] text-muted-foreground">
              {mode === "FULL_AUTO"
                ? "全自动：护栏通过后直接改预算"
                : "半自动：出方案等人批"}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="label-mono">可分配余额</p>
          <p className="mt-1 font-mono text-lg neon-text">${pool.balance.toLocaleString()}</p>
        </div>
        <div className="rounded-md border border-border bg-background/50 p-3">
          <p className="label-mono">待审批冻结</p>
          <p className="mt-1 font-mono text-lg">${pool.reserved.toLocaleString()}</p>
        </div>
      </div>

      <Collapsible open={rulesOpen} onOpenChange={setRulesOpen} className="mt-3">
        <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
          <ChevronDown
            className={cn("h-3.5 w-3.5 transition-transform", rulesOpen && "rotate-180")}
          />
          钱会拨给谁？
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
          <p>
            系统自动挑选合格广告组（不是人工打分，也不是 AI 随意决定）。优先补给授信质量更好、放款成本更可控、且今天预算花得动的组。当日拨不完的余额会作废，不留到明天。定时巡检也会自动尝试拨付；这里是池里有钱时立刻出一版方案。
          </p>
          <Collapsible>
            <CollapsibleTrigger className="text-[10px] text-muted-foreground/80 underline-offset-2 hover:text-foreground hover:underline">
              技术细则
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground/80">
              仅投放中或学习期可承接 · 近端授信通过率 ≥ 22% · CPS ≤ 账户基准的 1.1× ·
              今日消耗率 ≥ 60%。多组同时合格时，按「通过率优先、成本其次」的固定规则排序分配。
            </CollapsibleContent>
          </Collapsible>
        </CollapsibleContent>
      </Collapsible>

      <Collapsible
        open={flowOpen}
        onOpenChange={setFlowOpen}
        className="mt-3 border-t border-border pt-3"
      >
        <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 text-left">
          <span className="label-mono">
            流水
            {pool.entries.length > 0 ? ` · ${pool.entries.length} 笔` : ""}
            {pool.released > 0 || pool.allocated > 0
              ? ` · 释放 $${pool.released.toLocaleString()} / 已拨 $${pool.allocated.toLocaleString()}`
              : ""}
          </span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              flowOpen && "rotate-180",
            )}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2">
          {timeline.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              还没有释放记录；风控停组或降预算后会出现在这里。
            </p>
          ) : (
            <ul className="space-y-1.5">
              {timeline.map((e) => {
                const isRelease = e.direction === "RELEASE";
                return (
                  <li key={e.id} className="flex items-start justify-between gap-3 text-xs">
                    <span className="min-w-0 truncate text-muted-foreground">
                      {isRelease ? "−" : "+"}{" "}
                      {isRelease
                        ? (POOL_REASON_LABEL[e.reason] ?? e.reason)
                        : e.reason === "EXPIRED"
                          ? "过期回收"
                          : "拨给高胜率组"}
                      {" · "}
                      {e.adGroupName ?? "—"}
                      {e.status === "PENDING" && (
                        <span className="ml-1.5 text-neon">待批</span>
                      )}
                      {e.status === "REVERTED" && (
                        <span className="ml-1.5 text-destructive">已撤销</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-mono",
                        isRelease ? "text-destructive" : "text-neon",
                      )}
                    >
                      {isRelease ? "−" : "+"}${e.amount.toLocaleString()}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </CollapsibleContent>
      </Collapsible>

      {!isActive && compactEmpty && emptyExpanded && (
        <button
          type="button"
          className="mt-3 text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => setEmptyExpanded(false)}
        >
          收起
        </button>
      )}
    </section>
  );
}

/** 矩阵上方的行动条：仅有闲钱或待批时出现。 */
function BudgetPoolCallout() {
  const pool = useAgentStore((s) => s.budgetPool);
  const mode = useAgentStore((s) => s.mode);
  const [running, setRunning] = useState(false);
  if (pool.balance <= 0 && pool.reserved <= 0) return null;

  const scrollToPool = () => {
    document.getElementById("budget-pool")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-neon/40 bg-neon/5 px-4 py-3">
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">{poolStatusLine(pool)}</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {pool.balance > 0
            ? mode === "FULL_AUTO"
              ? "可直接拨付，或先查看下方闲置预算详情"
              : "可出方案进审批，或先查看下方闲置预算详情"
            : "请到指挥中心审批队列处理冻结金额"}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {pool.balance > 0 && (
          <Button
            size="sm"
            disabled={running}
            onClick={async () => {
              setRunning(true);
              try {
                const res = await agentApi.runReallocation();
                if (res.skipped === "EMPTY_POOL") toast("池里没有可分配余额");
                else if (res.skipped === "NO_ELIGIBLE_RECIPIENT") {
                  toast.warning("没有合格的高胜率组可承接");
                } else if (res.autoExecuted) {
                  toast.success(`已拨出 $${res.allocated.toLocaleString()}`);
                } else {
                  toast.success(`已生成审批卡 · $${res.allocated.toLocaleString()}`);
                }
              } catch (e) {
                toast.error("再分配失败", { description: String(e) });
              } finally {
                setRunning(false);
              }
            }}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {running ? "拨付中…" : "拨给高胜率组"}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={scrollToPool}>
          查看详情
        </Button>
      </div>
    </div>
  );
}


export const Route = createFileRoute("/campaigns")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: TABS.includes(search.tab as TabKey) ? (search.tab as TabKey) : ("budget" as TabKey),
  }),
  head: () => ({
    meta: [
      { title: "全托管预算调配引擎 | CreditAgent AI" },
      {
        name: "description",
        content:
          "Full-Auto / Semi-Auto 托管模式切换与多渠道预算矩阵：CPL、后端授信通过率与实际放款成本 CPS 一屏对比。",
      },
      { property: "og:title", content: "全托管预算调配引擎 | CreditAgent AI" },
      {
        property: "og:description",
        content: "Google Search / PMax 与 Meta Feed / Reels 的预算矩阵与 AI 调优建议。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => prefetchQueryNonBlocking(context.queryClient, agentSnapshotQuery),
  component: CampaignsPage,
});

const STATUS_STYLE: Record<AdGroup["status"], string> = {
  ACTIVE: "border-success/40 bg-success/12 text-success",
  PAUSED: "border-border bg-muted text-muted-foreground",
  LEARNING: "border-creative/40 bg-creative/12 text-creative",
  COMPLIANCE_HOLD: "border-compliance/40 bg-compliance/12 text-compliance",
};

const STATUS_LABEL: Record<AdGroup["status"], string> = {
  ACTIVE: "投放中",
  PAUSED: "已暂停",
  LEARNING: "学习期",
  COMPLIANCE_HOLD: "合规拦截",
};


function BudgetCell({ group }: { group: AdGroup }) {
  const [value, setValue] = useState(String(group.dailyBudget));
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(String(group.dailyBudget));
          setEditing(true);
        }}
        className="font-mono text-xs text-foreground underline decoration-dotted decoration-muted-foreground underline-offset-4"
      >
        ${group.dailyBudget.toLocaleString()}
      </button>
    );
  }

  return (
    <form
      className="flex items-center gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const next = Number(value);
        setEditing(false);
        if (!Number.isFinite(next) || next <= 0) return;
        try {
          const { guardrail, external } = await agentApi.setAdGroupBudget(
            group.id,
            Math.round(next),
          );
          if (guardrail?.verdict === "DENY") {
            toast.error("风控规则层已拦截该预算变动", { description: guardrail.detail });
          } else if (guardrail?.verdict === "CLAMP") {
            toast.warning("风控规则层已截断该预算", { description: guardrail.detail });
          } else {
            const t = toastForExternal(external);
            if (t.kind === "success") {
              toast.success(t.title, {
                description:
                  t.description ??
                  `${group.name} → $${Math.round(next).toLocaleString()} / 日`,
              });
            } else {
              toast.success("每日预算已更新（仅本地）", {
                description:
                  t.description ??
                  `${group.name} → $${Math.round(next).toLocaleString()} / 日`,
              });
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error("预算更新失败", {
            description: msg.replace(/^GOOGLE_ADS_UNBOUND:/, ""),
          });
        }
      }}
    >
      <Input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => setEditing(false)}
        className="h-7 w-24 font-mono text-xs"
      />
    </form>
  );
}

function CampaignsPage() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <AppShell>
      <header className="panel p-5">
        <p className="label-mono">module 02</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          广告投放与预算调配
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          层级：广告系列 Campaign → 广告组 Ad Group → 素材 Creative · Planner Agent 按后端放款表现在广告组层级分配资金
        </p>
      </header>

      <Tabs
        value={tab}
        onValueChange={(next) => navigate({ search: { tab: next as TabKey } })}
        className="mt-4"
      >
        <TabsList>
          <TabsTrigger value="budget">预算与托管</TabsTrigger>
          <TabsTrigger value="structure">投放结构</TabsTrigger>
        </TabsList>
        <TabsContent value="budget" className="mt-4 space-y-0">
          <BudgetTab />
        </TabsContent>
        <TabsContent value="structure" className="mt-4">
          <StructureTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}

function BudgetTab() {
  const campaigns = useAgentStore((s) => s.campaigns);
  const adGroups = useAgentStore((s) => s.adGroups);
  const mode = useAgentStore((s) => s.mode);
  const riskPosture = useAgentStore((s) => s.riskPosture);
  const limits = useAgentStore((s) => s.guardrailLimits);

  const [busyId, setBusyId] = useState<string | null>(null);

  const totalBudget = adGroups.reduce((s, g) => s + g.dailyBudget, 0);
  const totalSpent = adGroups.reduce((s, g) => s + g.spentToday, 0);
  const totalDisbursed = adGroups.reduce((s, g) => s + g.disbursedAmount, 0);
  const blendedCps =
    totalSpent / Math.max(1, adGroups.reduce((s, g) => s + g.approvedLoans, 0));

  const killSwitchOn = riskPosture === "KILL_SWITCH";

  const setKillSwitch = async (on: boolean) => {
    if (on === killSwitchOn) return;
    const res = await agentApi.setRiskPosture(on ? "KILL_SWITCH" : "RISK_FIRST");
    if (on) {
      toast.error("全局熔断已开启", {
        description: "所有 Agent 自动写入被拒绝，仅保留人工操作。",
      });
    } else if (res.pausedCampaigns.length) {
      toast.warning("已恢复风控优先", {
        description: `自动暂停：${res.pausedCampaigns.join("、")}`,
      });
    } else {
      toast.success("全局熔断已解除", { description: "已恢复风控优先（含通过率自动停组）。" });
    }
  };

  return (
    <>
      <section className="panel p-5">
        <p className="text-xs text-muted-foreground">
          托管模式、全局熔断与预算矩阵。创建系列/广告组请切到「投放结构」。
        </p>


        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <GoogleAdsConnectionPanel />
          <MetaAdsConnectionPanel />
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border bg-background/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-xs">托管模式</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {mode === "FULL_AUTO"
                    ? "全自动：护栏通过后，对已绑定的 Google / Meta 测试资源尝试推送；未绑定或 MODE=off 时仅本地。"
                    : "半自动：Agent 拟定计划后推送审批卡片，人工确认后执行。"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-[11px] transition-colors",
                    mode === "FULL_AUTO" ? "text-muted-foreground" : "text-neon",
                  )}
                >
                  半自动
                </span>
                <Switch
                  checked={mode === "FULL_AUTO"}
                  onCheckedChange={async (v) => {
                    await agentApi.setMode(v ? "FULL_AUTO" : "SEMI_AUTO");
                    toast.success(`托管模式已切换为${v ? "全自动" : "半自动"}`);
                  }}
                />
                <span
                  className={cn(
                    "text-[11px] transition-colors",
                    mode === "FULL_AUTO" ? "text-neon" : "text-muted-foreground",
                  )}
                >
                  全自动
                </span>
              </div>

            </div>
          </div>
        </div>

        <div
          className={cn(
            "mt-4 rounded-md border p-4 transition-colors",
            killSwitchOn
              ? "border-destructive/60 bg-destructive/10"
              : "border-border bg-background/50",
          )}
        >
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <Label className="text-xs">
                  全局熔断
                  {killSwitchOn && (
                    <span className="ml-2 text-destructive">已冻结自动执行</span>
                  )}
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {killSwitchOn
                    ? "紧急开关：冻结一切 Agent 自动写入；审批也不会推送外部平台，仅保留人工操作。"
                    : "日常默认风控优先：近 20 条 Lead 授信通过率 < 10% 时自动暂停该广告组。需要止血时再开熔断。"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-[11px] transition-colors",
                    killSwitchOn ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  熔断
                </span>
                <Switch checked={killSwitchOn} onCheckedChange={(v) => void setKillSwitch(v)} />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              硬编码护栏始终生效：单次预算变动 ≤ {limits.maxBudgetDeltaPct}% · 单日累计 ≤{" "}
              {limits.maxDailyBudgetDeltaPct}% · 广告组日预算 ≤ $
              {limits.maxAdGroupDailyBudget.toLocaleString()} · 每小时自动动作 ≤{" "}
              {limits.maxActionsPerHour} 条。触发即拒绝或截断，并降级为人工审批。
            </p>
          </div>
        </div>
      </section>

      <BudgetPoolCallout />

      <section className="panel mt-4 overflow-hidden">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold tracking-wide">
            广告系列 / 广告组预算矩阵
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            广告系列为渠道级归集，广告组承载版位、受众与出价策略 · 点击预算可手动接管
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              { label: "今日预算总额", value: `$${totalBudget.toLocaleString()}` },
              { label: "今日已花费", value: `$${totalSpent.toLocaleString()}` },
              { label: "30 天放款金额", value: `$${(totalDisbursed / 1000).toFixed(0)}k` },
              { label: "综合放款成本 CPS", value: `$${blendedCps.toFixed(2)}` },
            ].map((s) => (
              <div key={s.label} className="rounded-md border border-border bg-background/50 p-3">
                <p className="label-mono">{s.label}</p>
                <p className="mt-1 font-mono text-lg neon-text">{s.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="label-mono">渠道 / 版位</TableHead>
                <TableHead className="label-mono">广告组</TableHead>
                <TableHead className="label-mono">今日预算</TableHead>
                <TableHead className="label-mono">CPL</TableHead>
                <TableHead className="label-mono">后端授信通过率</TableHead>
                <TableHead className="label-mono">放款成本 CPS</TableHead>
                <TableHead className="label-mono">状态</TableHead>
                <TableHead className="label-mono">AI 建议 / 操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.map((camp) => {
                const groups = adGroups.filter((g) => g.campaignId === camp.id);
                const campBudget = groups.reduce((s, g) => s + g.dailyBudget, 0);
                return (
                  <Fragment key={camp.id}>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={8} className="py-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="label-mono">广告系列</span>
                          <ChannelBadge channel={camp.channel} />
                          <span className="text-sm font-semibold">{camp.name}</span>
                          <span className="font-mono text-[11px] text-muted-foreground">
                            {groups.length} 个广告组 · 日预算合计 ${campBudget.toLocaleString()}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {groups.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell>
                          <ChannelBadge channel={c.channel} />
                          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                            {c.placement}
                          </p>
                        </TableCell>
                        <TableCell className="max-w-[260px]">
                          <p className="truncate text-sm">{c.name}</p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {c.audience} · {c.bidStrategy}
                            {c.bidTarget != null ? ` $${c.bidTarget}` : ""}
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {c.leads} 条线索 · {c.approvedLoans} 笔通过
                          </p>
                          <AdGroupCreatives adGroupId={c.id} />
                        </TableCell>

                        <TableCell>
                          <BudgetCell group={c} />
                          <p className="font-mono text-[11px] text-muted-foreground">
                            已花费 ${c.spentToday.toLocaleString()}
                          </p>

                        </TableCell>
                        <TableCell className="font-mono text-xs">${c.cpl.toFixed(2)}</TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "font-mono text-xs",
                              c.last20ApprovalRate < 0.1
                                ? "text-destructive"
                                : c.last20ApprovalRate < 0.22
                                  ? "text-warning"
                                  : "text-success",
                            )}
                          >
                            {(c.last20ApprovalRate * 100).toFixed(1)}%
                          </span>
                          <p className="text-[11px] text-muted-foreground">最近 20 条线索</p>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "font-mono text-xs",
                              c.cps > 19 ? "text-destructive" : "text-success",
                            )}
                          >
                            ${c.cps.toFixed(2)}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex rounded border px-2 py-0.5 text-[11px]",
                              STATUS_STYLE[c.status],
                            )}
                          >
                            {STATUS_LABEL[c.status]}
                          </span>
                        </TableCell>

                        <TableCell className="max-w-[280px]">
                          <p className="text-xs text-muted-foreground">{c.aiSuggestion}</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busyId === c.id}
                              className="text-[11px]"
                              onClick={async () => {
                                setBusyId(c.id);
                                try {
                                  const d = await agentApi.applyAiSuggestion(c.id);
                                  if (d?.status === "EXECUTED") {
                                    toast.success("全自动模式已执行", { description: d.effect });
                                  } else if (d) {
                                    toast.warning("已推送至人工审批队列", { description: d.effect });
                                  }
                                } finally {
                                  setBusyId(null);
                                }
                              }}
                            >
                              <Sparkles className="size-3.5" /> 应用建议
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busyId === c.id}
                              className="text-[11px]"
                              onClick={async () => {
                                setBusyId(c.id);
                                try {
                                  const next = c.status === "PAUSED" ? "ACTIVE" : "PAUSED";
                                  await agentApi.setAdGroupStatus(c.id, next);
                                  toast(`${c.name} → ${STATUS_LABEL[next]}`);

                                } finally {
                                  setBusyId(null);
                                }
                              }}
                            >
                              {c.status === "PAUSED" ? (
                                <>
                                  <Play className="size-3.5" /> 启用
                                </>
                              ) : (
                                <>
                                  <Pause className="size-3.5" /> 暂停
                                </>
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>

      <BudgetPoolPanel />
    </>
  );
}

/** In-flight creatives carried by an ad group, with fatigue warning. */
function AdGroupCreatives({ adGroupId }: { adGroupId: string }) {
  const placements = useAgentStore((s) => s.placements);
  const creatives = useAgentStore((s) => s.creatives);
  const rows = placements.filter((p) => p.adGroupId === adGroupId && p.status === "ACTIVE");
  if (rows.length === 0) {
    return <p className="mt-1.5 text-[11px] text-muted-foreground">暂无在投素材</p>;
  }
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="label-mono">在投素材</span>
      {rows.map((p) => {
        const c = creatives.find((x) => x.id === p.creativeId);
        const fatigued = c?.fatigueLevel === "FATIGUED";
        const watch = c?.fatigueLevel === "WATCH";
        return (
          <Link
            key={p.creativeId}
            to="/creative"
            search={{ tab: "library" as const }}
            className={cn(
              "inline-flex max-w-[180px] items-center gap-1.5 truncate rounded border px-2 py-0.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon",
              fatigued
                ? "border-destructive/50 text-destructive"
                : watch
                  ? "border-warning/50"
                  : "border-border",
            )}
          >
            <span className="truncate">{c?.headline ?? p.creativeId}</span>
            <span className="font-mono text-[10px] opacity-70">
              {(p.share * 100).toFixed(0)}%
            </span>
            {p.leads > 0 && (
              <span className="font-mono text-[10px] opacity-70">
                {p.leads}线索/{p.disbursedCount}放款
              </span>
            )}
            {fatigued && <span className="font-mono text-[10px]">疲劳</span>}
          </Link>
        );
      })}
    </div>
  );
}

