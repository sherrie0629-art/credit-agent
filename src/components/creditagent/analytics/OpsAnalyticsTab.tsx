import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Loader2 } from "lucide-react";

import { fetchOpsAnalyticsFn } from "@/lib/creditagent/report.functions";
import { TARGET_CPS, formatDelta, pctDelta, type WeekKey } from "@/lib/creditagent/report";
import type { PeriodFacts, DecisionBriefItem, OpsDiagnosticItem } from "@/lib/creditagent/report";
import type {
  ChannelBreakdownRow,
  ChannelTrendPoint,
  FeedbackHealth,
  FunnelStageRow,
} from "@/lib/creditagent/types";
import { useAgentStore } from "@/lib/creditagent/store";
import { cn } from "@/lib/utils";

export function OpsAnalyticsTab({
  week,
  onWeekChange,
}: {
  week: WeekKey;
  onWeekChange: (w: WeekKey) => void;
}) {
  const funnelFallback = useAgentStore((s) => s.funnel);
  const trendFallback = useAgentStore((s) => s.channelTrend);
  const breakdownFallback = useAgentStore((s) => s.channelBreakdown);
  const feedbackFallback = useAgentStore((s) => s.feedbackHealth);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodFacts | null>(null);
  const [prior, setPrior] = useState<PeriodFacts | null>(null);
  const [insights, setInsights] = useState<string[]>([]);
  const [decisionBrief, setDecisionBrief] = useState<DecisionBriefItem[]>([]);
  const [opsDiagnostics, setOpsDiagnostics] = useState<OpsDiagnosticItem[]>([]);
  const [feedback, setFeedback] = useState<FeedbackHealth[]>(feedbackFallback);
  const [funnel, setFunnel] = useState<FunnelStageRow[]>(funnelFallback);
  const [channelTrend, setChannelTrend] = useState<ChannelTrendPoint[]>(trendFallback);
  const [channelBreakdown, setChannelBreakdown] =
    useState<ChannelBreakdownRow[]>(breakdownFallback);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchOpsAnalyticsFn({ data: { week } })
      .then((res) => {
        if (cancelled) return;
        setPeriod(res.period);
        setPrior(res.prior);
        setInsights(res.insights ?? []);
        setDecisionBrief(res.decisionBrief ?? []);
        setOpsDiagnostics(res.opsDiagnostics ?? []);
        setFeedback(res.feedbackHealth);
        setFunnel(res.funnel);
        setChannelTrend(res.channelTrend);
        setChannelBreakdown(res.channelBreakdown);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [week]);

  const top = funnel[0]?.value ?? 1;
  const cps = period?.cps ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="label-mono">周期</span>
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(
              [
                ["this", "本周"],
                ["last", "上周"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onWeekChange(key)}
                className={cn(
                  "rounded px-3 py-1 text-xs transition-colors",
                  week === key ? "bg-neon/15 text-neon" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {period && (
            <span className="font-mono text-[11px] text-muted-foreground">{period.window.label}</span>
          )}
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <p className="text-[11px] text-muted-foreground">
          目标 CPS ${TARGET_CPS.toFixed(2)}
          {period && period.disbursedCount > 0 && (
            <>
              {" "}
              · 本期实际{" "}
              <span className={cn("font-mono", cps > TARGET_CPS ? "text-destructive" : "text-success")}>
                ${cps.toFixed(2)}
              </span>
            </>
          )}
        </p>
      </div>

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          周期数据加载失败：{error}
        </p>
      )}

      {period && (
        <section className="panel p-4">
          <p className="label-mono">本期 KPI · 较上周</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi
              label="线索"
              value={period.leads.toLocaleString()}
              delta={prior ? pctDelta(period.leads, prior.leads) : null}
            />
            <Kpi
              label="授信通过"
              value={period.approved.toLocaleString()}
              hint={`${(period.approvalRate * 100).toFixed(1)}%`}
              delta={prior ? pctDelta(period.approved, prior.approved) : null}
            />
            <Kpi
              label="放款金额"
              value={`$${Math.round(period.disbursedAmount).toLocaleString()}`}
              delta={prior ? pctDelta(period.disbursedAmount, prior.disbursedAmount) : null}
            />
            <Kpi
              label="综合 CPS"
              value={period.disbursedCount > 0 ? `$${period.cps.toFixed(2)}` : "—"}
              hint={`目标 $${TARGET_CPS.toFixed(2)}`}
              delta={prior && prior.cps > 0 ? pctDelta(period.cps, prior.cps) : null}
              warn={period.disbursedCount > 0 && period.cps > TARGET_CPS}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">{period.spendNote}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            花费快照（今日） ${Math.round(period.spendSnapshotToday).toLocaleString()}
            {prior
              ? ` · 上周快照环比 ${formatDelta(pctDelta(period.spendSnapshotToday, prior.spendSnapshotToday))}`
              : ""}
          </p>
        </section>
      )}

      {(decisionBrief.length > 0 || opsDiagnostics.length > 0 || insights.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {decisionBrief.length > 0 ? (
            <section className="panel space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold tracking-wide">经营简报</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  给 CEO / COO：结论 → 为何重要 → 动作 → 利害（不复读上方 KPI）
                </p>
              </div>
                  {decisionBrief.map((item) => (
                <article
                  key={item.id}
                  className="rounded-md border border-border bg-background/50 px-3 py-2.5 space-y-1.5"
                >
                  <p className="text-xs font-medium text-foreground leading-snug">{item.conclusion}</p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <span className="text-muted-foreground/80">为何重要 · </span>
                    {item.why}
                  </p>
                  <p className="text-[11px] text-foreground/90 leading-relaxed">
                    <span className="text-neon/90">建议 · </span>
                    {item.action}
                  </p>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    <span className="text-muted-foreground/80">利害 · </span>
                    {item.stakes}
                  </p>
                  {item.confidence === "low" && item.confidenceNote && (
                    <p className="text-[10px] text-amber-200/70">{item.confidenceNote}</p>
                  )}
                </article>
              ))}
            </section>
          ) : insights.length > 0 ? (
            <section className="panel space-y-2 p-4">
              <h2 className="text-sm font-semibold tracking-wide">经营简报</h2>
              {insights.map((line) => (
                <p
                  key={line}
                  className="rounded-md border border-border bg-background/50 px-3 py-2 text-xs text-muted-foreground"
                >
                  {line}
                </p>
              ))}
            </section>
          ) : null}

          {opsDiagnostics.length > 0 && (
            <section className="panel space-y-3 p-4">
              <div>
                <h2 className="text-sm font-semibold tracking-wide">运营诊断</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  给投放同学：回传口径、组集中度、渠道差等排障线索
                </p>
              </div>
              {opsDiagnostics.map((d) => (
                <div
                  key={d.id}
                  className={cn(
                    "rounded-md border px-3 py-2",
                    d.severity === "critical" && "border-destructive/40 bg-destructive/10",
                    d.severity === "warn" && "border-amber-500/30 bg-amber-500/5",
                    d.severity === "info" && "border-border bg-background/50",
                  )}
                >
                  <p className="text-xs font-medium text-foreground">{d.title}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed">{d.detail}</p>
                </div>
              ))}
            </section>
          )}
        </div>
      )}

      <FeedbackHealthStrip feedback={feedback} />

      <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <section className="panel p-5">
          <h2 className="text-sm font-semibold tracking-wide">转化漏斗</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            前端曝光到后端放款的真实衰减链路（全量快照；KPI 条为选定周期）
          </p>
          <div className="mt-5 space-y-3">
            {funnel.map((s, i) => {
              const pct = (s.value / top) * 100;
              const prev = i === 0 ? null : funnel[i - 1].value;
              return (
                <div key={s.stage}>
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-xs">
                      <span className="text-neon">{String(i + 1).padStart(2, "0")}</span> {s.stage}
                    </p>
                    <p className="font-mono text-xs">
                      {s.value.toLocaleString()}
                      {prev !== null && (
                        <span className="ml-2 text-muted-foreground">
                          {((s.value / prev) * 100).toFixed(1)}%
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="mt-1.5 h-7 w-full overflow-hidden rounded border border-border bg-background/50">
                    <div
                      className={cn("h-full rounded-r", i >= 3 ? "bg-success/35" : "bg-neon/30")}
                      style={{ width: `${Math.max(pct, 3)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{s.note}</p>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel p-5">
          <h2 className="text-sm font-semibold tracking-wide">
            Google vs Meta · 前端 ROI 与真实 30 天 ROAS
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            虚线 = 前端 ROI；实线 = 真实 ROAS · 水平线 = 盈亏参考 1.0x
          </p>
          <div className="mt-5 h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={channelTrend}>
                <CartesianGrid stroke="var(--grid-line)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="day"
                  stroke="var(--muted-foreground)"
                  tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
                />
                <YAxis
                  stroke="var(--muted-foreground)"
                  tick={{ fontSize: 11, fontFamily: "var(--font-mono)" }}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "var(--popover-foreground)",
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, fontFamily: "var(--font-mono)" }} />
                <ReferenceLine
                  y={1}
                  stroke="var(--warning)"
                  strokeDasharray="3 3"
                  label={{ value: "1.0x", fill: "var(--muted-foreground)", fontSize: 10 }}
                />
                <Line
                  type="monotone"
                  dataKey="googleFrontEndRoi"
                  name="Google 前端 ROI"
                  stroke="var(--google)"
                  strokeDasharray="4 4"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="metaFrontEndRoi"
                  name="Meta 前端 ROI"
                  stroke="var(--meta)"
                  strokeDasharray="4 4"
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="googleTrueRoas"
                  name="Google 真实 ROAS"
                  stroke="var(--success)"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="metaTrueRoas"
                  name="Meta 真实 ROAS"
                  stroke="var(--compliance)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            CPS 目标线 ${TARGET_CPS.toFixed(2)} 用于预算 Agent；上图 ROAS 盈亏线为 1.0x。
          </p>
        </section>
      </div>

      <section className="panel mt-0 p-5">
        <h2 className="text-sm font-semibold tracking-wide">分渠道后端归因</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {channelBreakdown.map((c) => (
            <div
              key={c.adGroupId ?? c.channel}
              className="rounded-md border border-border bg-background/50 p-4"
            >
              <div className="flex items-baseline justify-between gap-2">
                <div>
                  <p className="text-xs">{c.channel}</p>
                  {c.adGroupName && (
                    <p className="font-mono text-[10px] text-muted-foreground">
                      广告组 {c.adGroupName}
                    </p>
                  )}
                </div>
                {c.adGroupId && (
                  <Link
                    to="/campaigns"
                    search={{ tab: "budget" }}
                    className="font-mono text-[10px] text-muted-foreground transition-colors hover:text-neon"
                  >
                    {c.adGroupId} →
                  </Link>
                )}
              </div>
              <p className="mt-3 label-mono">放款金额</p>
              <p className="font-mono text-lg neon-text">${(c.disbursed / 1000).toFixed(1)}k</p>
              <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                <p>
                  广告花费 <span className="font-mono">${c.spend.toLocaleString()}</span>
                </p>
                <p>
                  线索 / 放款{" "}
                  <span className="font-mono text-foreground">
                    {(c.leads ?? 0).toLocaleString()} / {(c.disbursedCount ?? 0).toLocaleString()} 笔
                  </span>
                </p>
                <p>
                  CPS{" "}
                  <span
                    className={cn(
                      "font-mono",
                      c.cps > TARGET_CPS ? "text-destructive" : "text-success",
                    )}
                  >
                    ${c.cps.toFixed(2)}
                  </span>
                  <span className="ml-1 text-muted-foreground">/ 目标 ${TARGET_CPS}</span>
                </p>
                <p>
                  授信通过率{" "}
                  <span
                    className={cn(
                      "font-mono",
                      c.approval < 0.1 ? "text-destructive" : "text-success",
                    )}
                  >
                    {(c.approval * 100).toFixed(1)}%
                  </span>
                </p>
              </div>
              <ChannelCreatives adGroupId={c.adGroupId} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  delta,
  warn,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: number | null;
  warn?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background/50 p-3">
      <p className="label-mono">{label}</p>
      <p className={cn("mt-1 font-mono text-lg", warn ? "text-destructive" : "neon-text")}>
        {value}
      </p>
      <p className="mt-1 font-mono text-[11px] text-muted-foreground">
        {hint}
        {delta !== undefined && delta !== null && (
          <span className="ml-1">· {formatDelta(delta)}</span>
        )}
        {delta === null && <span className="ml-1">· —</span>}
      </p>
    </div>
  );
}

function FeedbackHealthStrip({ feedback }: { feedback: FeedbackHealth[] }) {
  if (feedback.length === 0) return null;
  return (
    <section className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide">回传健康度</h2>
        <Link
          to="/conversions"
          className="font-mono text-[11px] text-muted-foreground transition-colors hover:text-neon"
        >
          打开回传模块 →
        </Link>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {feedback.map((h) => {
          const warn = h.successRate < 0.9 || h.gapRate > 0.1;
          return (
            <div
              key={h.channel}
              className={cn(
                "rounded-md border p-3",
                warn
                  ? "border-warning/40 bg-warning/8"
                  : "border-border bg-background/50",
              )}
            >
              <p className="font-mono text-xs">
                {h.channel}
                <span className="ml-2 text-muted-foreground">
                  成功 {h.sent}/{h.attempted}
                </span>
              </p>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                回传成功率{" "}
                <span
                  className={cn(
                    "font-mono",
                    h.successRate < 0.9 ? "text-warning" : "text-success",
                  )}
                >
                  {(h.successRate * 100).toFixed(1)}%
                </span>
                ，放款缺口{" "}
                <span
                  className={cn(
                    "font-mono",
                    h.gapRate > 0.1 ? "text-destructive" : "text-success",
                  )}
                >
                  {(h.gapRate * 100).toFixed(0)}%
                </span>
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ChannelCreatives({ adGroupId }: { adGroupId?: string }) {
  const placements = useAgentStore((s) => s.placements);
  const creatives = useAgentStore((s) => s.creatives);
  if (!adGroupId) return null;
  const rows = placements.filter((p) => p.adGroupId === adGroupId && p.status === "ACTIVE");
  if (rows.length === 0) return null;
  return (
    <div className="mt-3 space-y-1 border-t border-border pt-2">
      <p className="label-mono">素材下钻</p>
      {rows.map((p) => {
        const c = creatives.find((x) => x.id === p.creativeId);
        const b = c?.backend;
        return (
          <Link
            key={p.creativeId}
            to="/creative"
            search={{ tab: "library" as const, creativeId: p.creativeId }}
            className="flex items-baseline justify-between gap-2 text-[11px] transition-colors hover:text-neon"
          >
            <span className="truncate">{c?.headline ?? p.creativeId}</span>
            <span className="shrink-0 font-mono text-muted-foreground">
              {p.leads > 0
                ? `${p.leads}线索 / ${p.disbursedCount}放款`
                : b
                  ? `全域 ${b.leads}线索`
                  : "—"}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
