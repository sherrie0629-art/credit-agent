import { createFileRoute } from "@tanstack/react-router";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AppShell } from "@/components/creditagent/AppShell";
import { useAgentStore } from "@/lib/creditagent/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "全链路放款归因分析 | CreditAgent AI" },
      {
        name: "description",
        content:
          "Impressions → Clicks → Leads → 授信通过 → 实际放款 全漏斗归因，对比前端 CPL ROI 与真实 30 天 LTV/ROAS。",
      },
      { property: "og:title", content: "全链路放款归因分析 | CreditAgent AI" },
      {
        property: "og:description",
        content: "通过 Meta CAPI 与 Google 离线转化回传打通授信与放款数据。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const funnel = useAgentStore((s) => s.funnel);
  const channelTrend = useAgentStore((s) => s.channelTrend);
  const channelBreakdown = useAgentStore((s) => s.channelBreakdown);
  const top = funnel[0]?.value ?? 1;

  return (
    <AppShell>
      <header className="panel p-5">
        <p className="label-mono">module 04</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Full-Funnel Analytics</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          全链路放款数据归因中心 · Meta CAPI + Google Offline Conversion Tracking 回传
        </p>
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_1.2fr]">
        <section className="panel p-5">
          <h2 className="font-mono text-sm uppercase tracking-widest">Conversion Funnel</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            前端曝光到后端放款的真实衰减链路
          </p>
          <div className="mt-5 space-y-3">
            {funnel.map((s, i) => {
              const pct = (s.value / top) * 100;
              const prev = i === 0 ? null : funnel[i - 1].value;
              return (
                <div key={s.stage}>
                  <div className="flex items-baseline justify-between">
                    <p className="font-mono text-xs">
                      <span className="text-neon">{String(i + 1).padStart(2, "0")}</span>{" "}
                      {s.stage}
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
                      className={cn(
                        "h-full rounded-r",
                        i >= 3 ? "bg-success/35" : "bg-neon/30",
                      )}
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
          <h2 className="font-mono text-sm uppercase tracking-widest">
            Google vs Meta — 前端 ROI vs 真实 30 天 ROAS
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            虚线 = 以 CPL 计算的前端 ROI；实线 = 以实际利息收入计算的 30 天 LTV/ROAS
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
          <p className="mt-3 rounded-md border border-warning/30 bg-warning/8 p-3 text-xs text-muted-foreground">
            <span className="font-mono text-warning">INSIGHT · </span>
            Meta 前端 ROI 领先 26%，但真实 30 天 ROAS 已跌破盈亏平衡线 1.0x —— 前端 CPC/CPL
            与后端放款严重脱节，Planner Agent 已据此转移预算。
          </p>
        </section>
      </div>

      <section className="panel mt-4 p-5">
        <h2 className="font-mono text-sm uppercase tracking-widest">
          Downstream Attribution by Channel
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {channelBreakdown.map((c) => (
            <div key={c.channel} className="rounded-md border border-border bg-background/50 p-4">
              <p className="font-mono text-xs">{c.channel}</p>
              <p className="mt-3 label-mono">disbursed</p>
              <p className="font-mono text-lg neon-text">
                ${(c.disbursed / 1000).toFixed(0)}k
              </p>
              <div className="mt-3 space-y-1 font-mono text-[11px] text-muted-foreground">
                <p>spend ${c.spend.toLocaleString()}</p>
                <p>
                  cps{" "}
                  <span className={c.cps > 19 ? "text-destructive" : "text-success"}>
                    ${c.cps.toFixed(2)}
                  </span>
                </p>
                <p>
                  approval{" "}
                  <span className={c.approval < 0.1 ? "text-destructive" : "text-success"}>
                    {(c.approval * 100).toFixed(1)}%
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
