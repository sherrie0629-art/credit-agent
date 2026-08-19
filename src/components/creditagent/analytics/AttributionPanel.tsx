import { Link } from "@tanstack/react-router";
import { ArrowDownRight, ArrowUpRight, Minus, TrendingUp } from "lucide-react";

import type {
  AttributionBundle,
  AttributionGroup,
  CpsContribution,
} from "@/lib/creditagent/attribution";
import { cn } from "@/lib/utils";

const FACTOR_COLOR: Record<CpsContribution["key"], string> = {
  cpc: "bg-neon/70",
  leadCvr: "bg-compliance/70",
  disbRate: "bg-destructive/70",
};

function money(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

function signed(n: number) {
  return `${n > 0 ? "+" : n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
}

export function AttributionPanel({ data }: { data: AttributionBundle | null }) {
  if (!data) return null;

  if (!data.available) {
    return (
      <section className="panel p-5">
        <h2 className="text-sm font-semibold tracking-wide">归因洞察 · 为什么 &amp; 接下来</h2>
        <p className="mt-2 text-[11px] text-muted-foreground">{data.note}</p>
      </section>
    );
  }

  const { portfolio, lag } = data;

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide">归因洞察 · 为什么 &amp; 接下来</h2>
        <p className="font-mono text-[10px] text-muted-foreground">
          {data.window.curFrom} ~ {data.window.curTo} vs {data.window.priorFrom} ~{" "}
          {data.window.priorTo}
        </p>
      </div>

      {/* —— 组合层：因果 + 增量 + 时滞 —— */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <div className="rounded-md border border-border bg-background/50 p-4">
          <p className="label-mono">CPS 因果拆解（全盘）</p>
          {portfolio.decomposition ? (
            <>
              <p className="mt-2 text-xs leading-relaxed">{portfolio.decomposition.headline}</p>
              <ContributionBar parts={portfolio.decomposition.parts} />
              <div className="mt-2 space-y-1">
                {portfolio.decomposition.parts.map((p) => (
                  <div key={p.key} className="flex items-center justify-between text-[11px]">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span className={cn("h-2 w-2 rounded-sm", FACTOR_COLOR[p.key])} />
                      {p.label}
                      <span className="font-mono text-[10px]">
                        ×{p.ratio.toFixed(2)}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "font-mono",
                        p.contribution > 0 ? "text-destructive" : "text-success",
                      )}
                    >
                      {signed(p.contribution)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-2 font-mono text-[10px] text-muted-foreground">
                合计 ΔCPS {signed(portfolio.decomposition.deltaCps)} · 上期 $
                {portfolio.priorCps.toFixed(2)} → 本期 ${portfolio.curCps.toFixed(2)}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">对比期样本不足，暂不做拆解。</p>
          )}
        </div>

        <div className="rounded-md border border-border bg-background/50 p-4">
          <p className="label-mono">放款增量归因</p>
          {portfolio.growth ? (
            <>
              <p className="mt-2 text-xs leading-relaxed">{portfolio.growth.headline}</p>
              <div className="mt-3 space-y-1">
                {portfolio.growth.effects.map((e) => (
                  <div key={e.key} className="flex items-center justify-between text-[11px]">
                    <span className="text-muted-foreground">{e.label}</span>
                    <span
                      className={cn("font-mono", e.value >= 0 ? "text-success" : "text-destructive")}
                    >
                      {e.value >= 0 ? "+" : "-"}${Math.abs(e.value / 1000).toFixed(1)}k
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 label-mono">增量来自谁</p>
              <div className="mt-1 space-y-1">
                {portfolio.growth.contributors.slice(0, 3).map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-[11px]">
                    <span className="truncate text-muted-foreground">{c.name}</span>
                    <span
                      className={cn("font-mono", c.delta >= 0 ? "text-success" : "text-destructive")}
                    >
                      {c.delta >= 0 ? "+" : "-"}${Math.abs(c.delta / 1000).toFixed(1)}k
                    </span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">对比期线索不足，暂不做增量拆解。</p>
          )}
        </div>

        <div className="rounded-md border border-border bg-background/50 p-4">
          <p className="label-mono">时滞校正 CPS</p>
          {lag ? (
            <>
              <div className="mt-2 flex items-baseline gap-3">
                <div>
                  <p className="font-mono text-lg neon-text">${lag.adjustedCps.toFixed(2)}</p>
                  <p className="text-[10px] text-muted-foreground">成熟度折算后</p>
                </div>
                <div>
                  <p className="font-mono text-sm text-muted-foreground">
                    ${lag.realizedCps.toFixed(2)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">已实现</p>
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-border">
                <div
                  className="h-full bg-neon/70"
                  style={{ width: `${Math.min(100, lag.maturity * 100).toFixed(0)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">{lag.note}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                预计最终放款约{" "}
                <span className="font-mono text-foreground">
                  {lag.projectedDisbursed.toFixed(1)} 笔
                </span>
                ，新组不应按「已实现 CPS」直接判死。
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-muted-foreground">
              放款时滞样本不足（&lt; 5 笔），暂不做成熟度折算。
            </p>
          )}
        </div>
      </div>

      {/* —— 组级：因果条 + 预测 + 处方 —— */}
      <div className="mt-4 space-y-3">
        {data.groups.map((g) => (
          <GroupRow key={g.adGroupId} g={g} target={data.target} />
        ))}
      </div>

      <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{data.note}</p>
    </section>
  );
}

function ContributionBar({ parts }: { parts: CpsContribution[] }) {
  const total = parts.reduce((s, p) => s + Math.abs(p.contribution), 0) || 1;
  return (
    <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-border">
      {parts.map((p) => (
        <div
          key={p.key}
          className={cn(FACTOR_COLOR[p.key], p.contribution < 0 && "opacity-40")}
          style={{ width: `${(Math.abs(p.contribution) / total) * 100}%` }}
          title={`${p.label} ${signed(p.contribution)}`}
        />
      ))}
    </div>
  );
}

function GroupRow({ g, target }: { g: AttributionGroup; target: number }) {
  const over = g.cps > target;
  const p = g.prescription;
  const tone =
    p.action === "SCALE_UP"
      ? "text-success"
      : p.action === "HOLD" || p.action === "WATCH"
        ? "text-muted-foreground"
        : "text-destructive";
  const Icon =
    p.action === "SCALE_UP" ? ArrowUpRight : p.action === "HOLD" || p.action === "WATCH" ? Minus : ArrowDownRight;

  return (
    <div className="rounded-md border border-border bg-background/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-medium">{g.adGroupName}</p>
          <p className="font-mono text-[10px] text-muted-foreground">
            {g.channel} · 花费 {money(g.cur.spend)} · 线索 {g.cur.leads} · 放款 {g.cur.disbursed} 笔
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className={cn("font-mono text-sm", over ? "text-destructive" : "text-success")}>
            CPS ${g.cps.toFixed(2)}
          </span>
          <Link
            to="/campaigns"
            search={{ tab: "budget" }}
            className="font-mono text-[10px] text-muted-foreground transition-colors hover:text-neon"
          >
            {g.adGroupId} →
          </Link>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div>
          <p className="label-mono">为什么变</p>
          {g.decomposition ? (
            <>
              <p className="mt-1 text-[11px] leading-relaxed">{g.decomposition.headline}</p>
              <ContributionBar parts={g.decomposition.parts} />
            </>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">对比期样本不足，无法拆解。</p>
          )}
        </div>

        <div>
          <p className="label-mono">接下来会怎样</p>
          {g.forecast ? (
            <div className="mt-1 space-y-1 text-[11px] text-muted-foreground">
              <p className="flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3" />
                7 天后预测 CPS{" "}
                <span
                  className={cn(
                    "font-mono",
                    g.forecast.predicted > target ? "text-destructive" : "text-success",
                  )}
                >
                  ${Math.max(0, g.forecast.predicted).toFixed(2)}
                </span>
              </p>
              <p>
                日斜率{" "}
                <span className="font-mono text-foreground">
                  {g.forecast.slopePerDay >= 0 ? "+" : "-"}${Math.abs(g.forecast.slopePerDay).toFixed(2)}
                </span>{" "}
                · R² {g.forecast.r2.toFixed(2)} · 样本 {g.forecast.points} 天
              </p>
              {g.breachInDays !== null && g.breachInDays > 0 && (
                <p className="text-destructive">
                  按当前斜率约 {g.breachInDays.toFixed(1)} 天后触破目标线 ${target}
                </p>
              )}
              {g.forecast.confidence === "low" && (
                <p className="text-[10px]">趋势拟合度低，预测仅作方向参考。</p>
              )}
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">日级样本不足，暂不外推。</p>
          )}
        </div>

        <div>
          <p className="label-mono">处方</p>
          <p className={cn("mt-1 flex items-center gap-1 text-xs font-medium", tone)}>
            <Icon className="h-3.5 w-3.5" />
            {p.label}
            {p.deltaPct !== 0 && (
              <span className="font-mono">
                {p.deltaPct > 0 ? "+" : ""}
                {p.deltaPct}%
              </span>
            )}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p.detail}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{p.impact}</p>
          {p.confidence === "low" && (
            <p className="mt-1 text-[10px] text-muted-foreground">样本/拟合不足 · 建议人工复核</p>
          )}
        </div>
      </div>
    </div>
  );
}
