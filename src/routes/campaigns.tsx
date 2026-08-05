import { Fragment, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import { Pause, Play, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/creditagent/AppShell";
import { ChannelBadge } from "@/components/creditagent/badges";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { agentApi, useAgentStore, agentSnapshotQuery, prefetchQueryNonBlocking } from "@/lib/creditagent/store";
import type { AdGroup } from "@/lib/creditagent/types";
import { cn } from "@/lib/utils";

const POOL_REASON_LABEL: Record<string, string> = {
  RISK_PAUSE: "风控暂停释放",
  LOW_WIN_RATE: "低胜率削减",
  PACING: "节奏超速止损",
  SCALE_UP: "高胜率扩量",
  MANUAL: "人工调整",
  EXPIRED: "过期回收",
};

/**
 * 跨广告组预算再分配：被暂停 / 低胜率广告组释放的预算进入当日待分配池，
 * 由硬编码打分（授信通过率 + CPS + 消耗节奏）转移到高胜率广告组，每笔均留归因。
 */
function BudgetPoolPanel() {
  const pool = useAgentStore((s) => s.budgetPool);
  const [running, setRunning] = useState(false);

  const releases = pool.entries.filter((e) => e.direction === "RELEASE" && e.status === "APPLIED");
  const allocations = pool.entries.filter((e) => e.direction === "ALLOCATE");

  return (
    <section className="panel mt-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label-mono">budget pool · {pool.day || "—"}</p>
          <h2 className="mt-2 text-sm font-semibold tracking-wide">跨广告组预算再分配</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            暂停或低胜率广告组释放的预算先入池，再按硬编码评分（授信通过率 0.6 / CPS 0.4）转移到
            高胜率广告组 · 承接门槛：投放中 / 学习期 · 通过率 ≥ 22% · CPS ≤ 账户基准的 1.1× · 今日消耗率 ≥ 60%
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={running || pool.balance <= 0}
          onClick={async () => {
            setRunning(true);
            try {
              const res = await agentApi.runReallocation();
              if (res.skipped === "EMPTY_POOL") {
                toast("待分配池为空，无需再分配");
              } else if (res.skipped === "NO_ELIGIBLE_RECIPIENT") {
                toast.warning("无合格承接广告组", {
                  description: "资金留在池中，当日未使用将过期回收。",
                });
              } else {
                toast.success(
                  res.autoExecuted
                    ? `已转移 $${res.allocated.toLocaleString()} 至 ${res.allocations.length} 个广告组`
                    : `已生成再分配审批卡：$${res.allocated.toLocaleString()} 待人工确认`,
                );
              }
            } catch (e) {
              toast.error("再分配失败", { description: String(e) });
            } finally {
              setRunning(false);
            }
          }}
        >
          <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          {running ? "分配中…" : "执行预算再分配"}
        </Button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "可分配余额", value: pool.balance, accent: true },
          { label: "今日释放入池", value: pool.released },
          { label: "已生效分配", value: pool.allocated },
          { label: "待审批冻结", value: pool.reserved },
        ].map((s) => (
          <div key={s.label} className="rounded-md border border-border bg-background/50 p-3">
            <p className="label-mono">{s.label}</p>
            <p className={cn("mt-1 font-mono text-lg", s.accent && "neon-text")}>
              ${s.value.toLocaleString()}
            </p>
          </div>
        ))}
      </div>

      {pool.entries.length > 0 && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="label-mono">资金来源（释放）</p>
            <ul className="mt-2 space-y-1.5">
              {releases.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {e.adGroupName ?? "—"} · {POOL_REASON_LABEL[e.reason] ?? e.reason}
                  </span>
                  <span className="shrink-0 font-mono text-destructive">
                    −${e.amount.toLocaleString()}
                  </span>
                </li>
              ))}
              {releases.length === 0 && (
                <li className="text-xs text-muted-foreground">今日暂无释放记录。</li>
              )}
            </ul>
          </div>
          <div>
            <p className="label-mono">资金去向（分配）</p>
            <ul className="mt-2 space-y-1.5">
              {allocations.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {e.adGroupName ?? "过期回收"}
                    {e.status === "PENDING" && (
                      <span className="ml-1.5 text-neon">待审批</span>
                    )}
                    {e.status === "REVERTED" && (
                      <span className="ml-1.5 text-destructive">已撤销</span>
                    )}
                  </span>
                  <span className="shrink-0 font-mono text-neon">
                    +${e.amount.toLocaleString()}
                  </span>
                </li>
              ))}
              {allocations.length === 0 && (
                <li className="text-xs text-muted-foreground">今日暂无分配记录。</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}


export const Route = createFileRoute("/campaigns")({
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
        const guardrail = await agentApi.setAdGroupBudget(group.id, Math.round(next));
        if (guardrail?.verdict === "DENY") {
          toast.error("风控规则层已拦截该预算变动", { description: guardrail.detail });
        } else if (guardrail?.verdict === "CLAMP") {
          toast.warning("风控规则层已截断该预算", { description: guardrail.detail });
        } else {
          toast.success("每日预算已更新", {
            description: `${group.name} → $${Math.round(next).toLocaleString()} / 日`,
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
  const campaigns = useAgentStore((s) => s.campaigns);
  const adGroups = useAgentStore((s) => s.adGroups);
  const mode = useAgentStore((s) => s.mode);
  const riskFirst = useAgentStore((s) => s.riskFirst);
  const killSwitch = useAgentStore((s) => s.killSwitch);
  const limits = useAgentStore((s) => s.guardrailLimits);

  const [busyId, setBusyId] = useState<string | null>(null);

  const totalBudget = adGroups.reduce((s, g) => s + g.dailyBudget, 0);
  const totalSpent = adGroups.reduce((s, g) => s + g.spentToday, 0);
  const totalDisbursed = adGroups.reduce((s, g) => s + g.disbursedAmount, 0);
  const blendedCps =
    totalSpent / Math.max(1, adGroups.reduce((s, g) => s + g.approvedLoans, 0));

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


        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div className="rounded-md border border-border bg-background/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-xs">托管模式</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {mode === "FULL_AUTO"
                    ? "全自动：Agent 直接调用广告 API 执行调价与预算转移。"
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

          <div className="rounded-md border border-border bg-background/50 p-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label className="text-xs">风控优先模式</Label>

                <p className="mt-1 text-xs text-muted-foreground">
                  连续 20 个 Lead 授信通过率 &lt; 10% 时，Agent 自动暂停该广告组。
                </p>
              </div>
              <Switch
                checked={riskFirst}
                onCheckedChange={async (v) => {
                  const res = await agentApi.setRiskFirst(v);
                  if (v && res.pausedCampaigns.length) {
                    toast.warning("风控优先已触发自动暂停", {
                      description: res.pausedCampaigns.join("、"),
                    });
                  } else {
                    toast(`风控优先模式 ${v ? "已开启" : "已关闭"}`);
                  }
                }}
              />
            </div>
          </div>
        </div>

        <div
          className={cn(
            "mt-4 rounded-md border p-4 transition-colors",
            killSwitch ? "border-destructive/60 bg-destructive/10" : "border-border bg-background/50",
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0">
              <Label className="text-xs">
                风控规则层 · 全局熔断
                {killSwitch && <span className="ml-2 text-destructive">已冻结自动执行</span>}
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                API 执行前的最后一关，规则全部硬编码，不经过大模型：单次预算变动 ≤{" "}
                {limits.maxBudgetDeltaPct}% · 单日累计 ≤ {limits.maxDailyBudgetDeltaPct}% ·
                广告组日预算 ≤ ${limits.maxAdGroupDailyBudget.toLocaleString()} · 每小时自动动作 ≤{" "}
                {limits.maxActionsPerHour} 条。触发即拒绝或截断，并降级为人工审批。
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "text-[11px] transition-colors",
                  killSwitch ? "text-destructive" : "text-muted-foreground",
                )}
              >
                熔断
              </span>
              <Switch
                checked={killSwitch}
                onCheckedChange={async (v) => {
                  await agentApi.setKillSwitch(v);
                  if (v) {
                    toast.error("全局熔断已开启", {
                      description: "所有 Agent 自动写入被拒绝，仅保留人工操作。",
                    });
                  } else {
                    toast.success("全局熔断已解除", { description: "自动执行恢复。" });
                  }
                }}
              />
            </div>
          </div>
        </div>
      </header>

      <BudgetPoolPanel />



      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "今日预算总额", value: `$${totalBudget.toLocaleString()}` },
          { label: "今日已花费", value: `$${totalSpent.toLocaleString()}` },
          { label: "30 天放款金额", value: `$${(totalDisbursed / 1000).toFixed(0)}k` },
          { label: "综合放款成本 CPS", value: `$${blendedCps.toFixed(2)}` },
        ].map((s) => (
          <div key={s.label} className="panel p-4">
            <p className="label-mono">{s.label}</p>
            <p className="mt-2 font-mono text-xl neon-text">{s.value}</p>
          </div>
        ))}
      </div>

      <section className="panel mt-4 overflow-hidden">
        <div className="border-b border-border p-4">
          <h2 className="text-sm font-semibold tracking-wide">
            广告系列 / 广告组预算矩阵
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            广告系列为渠道级归集，广告组承载版位、受众与出价策略 · 点击预算可手动接管
          </p>
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
    </AppShell>
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

