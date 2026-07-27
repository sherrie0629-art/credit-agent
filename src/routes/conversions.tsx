import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { AppShell } from "@/components/creditagent/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  ERROR_LABELS,
  EVENT_LABELS,
  UPLOAD_STATUS_LABELS,
  type ConversionSnapshot,
  type UploadRow,
} from "@/lib/creditagent/conversion-types";
import {
  fetchConversionSnapshot,
  flushQueueFn,
  retryUploadFn,
  simulateBatchFn,
  updateConversionSettingFn,
} from "@/lib/creditagent/conversions.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/conversions")({
  head: () => ({
    meta: [
      { title: "离线转化回传中心 | CreditAgent AI" },
      {
        name: "description",
        content:
          "把授信与放款结果带价值回传给 Google Ads 离线转化与 Meta CAPI，监控回传成功率、匹配率与漏斗缺口。",
      },
      { property: "og:title", content: "离线转化回传中心 | CreditAgent AI" },
      {
        property: "og:description",
        content: "Google OCI + Meta CAPI 回传队列、错误码诊断与真实放款归因对照。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConversionsPage,
});

const STATUS_STYLE: Record<string, string> = {
  SENT: "border-success/40 bg-success/10 text-success",
  PENDING: "border-border bg-muted/40 text-muted-foreground",
  FAILED: "border-destructive/40 bg-destructive/10 text-destructive",
  SKIPPED: "border-warning/40 bg-warning/10 text-warning",
};

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="panel p-4">
      <p className="label-mono">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold neon-text">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function ConversionsPage() {
  const [snap, setSnap] = useState<ConversionSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<string>("ALL");
  const [open, setOpen] = useState<string | null>(null);
  const [simLeads, setSimLeads] = useState(20);
  const [simRate, setSimRate] = useState(40);

  useEffect(() => {
    fetchConversionSnapshot()
      .then(setSnap)
      .catch(() => toast.error("无法加载回传数据"));
  }, []);

  const uploads = useMemo(
    () => (snap?.uploads ?? []).filter((u) => filter === "ALL" || u.status === filter),
    [snap, filter],
  );

  async function run<T>(fn: () => Promise<T>, done: (r: T) => void) {
    setBusy(true);
    try {
      done(await fn());
    } catch {
      toast.error("操作失败，请重试");
    } finally {
      setBusy(false);
    }
  }

  const k = snap?.kpis;

  return (
    <AppShell>
      <header className="panel flex flex-wrap items-start justify-between gap-4 p-5">
        <div>
          <p className="label-mono">module 06</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">离线转化回传</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            把后端授信 / 放款结果带金额价值回传给 Google Ads 离线转化与 Meta CAPI ·
            当前运行在模拟适配器
          </p>
        </div>
        <Button
          disabled={busy}
          onClick={() =>
            run(
              () => flushQueueFn(),
              (r) => {
                setSnap(r.snapshot);
                toast.success(
                  `回传完成：成功 ${r.result.sent} · 失败 ${r.result.failed} · 跳过 ${r.result.skipped}`,
                );
              },
            )
          }
        >
          立即回传
        </Button>
      </header>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="回传成功率"
          value={`${((k?.successRate ?? 0) * 100).toFixed(1)}%`}
          hint={`成功 ${k?.sent ?? 0} · 失败 ${k?.failed ?? 0}`}
        />
        <Kpi
          label="平均匹配质量"
          value={`${((k?.matchRate ?? 0) * 100).toFixed(1)}%`}
          hint="平台侧可匹配到点击/用户的比例"
        />
        <Kpi
          label="平均回传延迟"
          value={`${(k?.avgLatencyMinutes ?? 0).toFixed(0)} 分钟`}
          hint={`待回传 ${k?.pending ?? 0} · 已跳过 ${k?.skipped ?? 0}`}
        />
        <Kpi
          label="已回传价值"
          value={`$${(k?.uploadedValue ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
          hint={`线索池 ${snap?.leadCount ?? 0} 条`}
        />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <section className="panel p-5">
          <h2 className="text-sm font-semibold tracking-wide">数据库放款 vs 平台已接收</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            两条柱子的差额就是平台出价模型看不到的后端转化
          </p>
          <div className="mt-4 h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={snap?.attribution ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="dbDisbursed" name="数据库真实放款" fill="hsl(var(--muted-foreground))" />
                <Bar dataKey="platformReported" name="平台已接收" fill="hsl(var(--neon))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>

        <div className="space-y-4">
          <section className="panel p-5">
            <h2 className="text-sm font-semibold tracking-wide">回传配置</h2>
            <div className="mt-3 space-y-4">
              {(snap?.settings ?? []).map((s) => (
                <div key={s.platform} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      {s.platform === "google" ? "Google Ads 离线转化" : "Meta CAPI"}
                    </p>
                    <span
                      className={cn(
                        "rounded border px-2 py-0.5 font-mono text-[10px]",
                        s.mode === "MOCK"
                          ? "border-warning/40 bg-warning/10 text-warning"
                          : "border-success/40 bg-success/10 text-success",
                      )}
                    >
                      {s.mode === "MOCK" ? "模拟模式" : "LIVE"}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {s.platform === "google" ? "Customer ID" : "Dataset ID"}：{s.destinationId || "未配置"}
                  </p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    回溯窗口：{s.lookbackDays} 天
                  </p>
                  <div className="mt-3 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">启用回传</span>
                    <Switch
                      checked={s.enabled}
                      disabled={busy}
                      onCheckedChange={(v) =>
                        run(
                          () =>
                            updateConversionSettingFn({
                              data: { platform: s.platform, enabled: v },
                            }),
                          (next) => setSnap(next),
                        )
                      }
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">切换到 LIVE</span>
                    <Switch
                      checked={s.mode === "LIVE"}
                      disabled
                      aria-label="LIVE 模式待接入广告账户"
                    />
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    LIVE 待接入广告账户凭证后开放
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="text-sm font-semibold tracking-wide">模拟信贷系统</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              生成一批带点击标识的线索，并按通过率推进授信 / 放款事件
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="text-xs text-muted-foreground">
                线索数量
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={simLeads}
                  onChange={(e) => setSimLeads(Number(e.target.value))}
                  className="mt-1"
                />
              </label>
              <label className="text-xs text-muted-foreground">
                授信通过率 %
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={simRate}
                  onChange={(e) => setSimRate(Number(e.target.value))}
                  className="mt-1"
                />
              </label>
            </div>
            <Button
              variant="secondary"
              className="mt-3 w-full"
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    simulateBatchFn({
                      data: {
                        leads: Math.min(Math.max(simLeads, 1), 100),
                        approvalRate: Math.min(Math.max(simRate, 0), 100) / 100,
                      },
                    }),
                  (r) => {
                    setSnap(r.snapshot);
                    toast.success(
                      `已生成 ${r.result.leads} 条线索、${r.result.events} 个事件，入队 ${r.result.queued} 条回传`,
                    );
                  },
                )
              }
            >
              生成模拟数据
            </Button>
          </section>
        </div>
      </div>

      <section className="panel mt-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-wide">回传队列</h2>
          <div className="flex gap-1">
            {["ALL", "PENDING", "SENT", "FAILED", "SKIPPED"].map((s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                className={cn(
                  "rounded border px-2 py-1 font-mono text-[10px]",
                  filter === s
                    ? "border-neon/50 bg-neon/10 text-neon"
                    : "border-border text-muted-foreground",
                )}
              >
                {s === "ALL" ? "全部" : UPLOAD_STATUS_LABELS[s as UploadRow["status"]]}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-xs">
            <thead className="text-muted-foreground">
              <tr className="border-b border-border">
                <th className="py-2 font-medium">事件</th>
                <th className="py-2 font-medium">渠道 / 平台</th>
                <th className="py-2 font-medium">价值</th>
                <th className="py-2 font-medium">状态</th>
                <th className="py-2 font-medium">错误码</th>
                <th className="py-2 font-medium">重试</th>
                <th className="py-2 font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {uploads.slice(0, 60).map((u) => (
                <Fragment key={u.id}>
                  <tr className="border-b border-border/60">
                    <td className="py-2">
                      <p className="font-medium">{EVENT_LABELS[u.eventType]}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">{u.leadId}</p>
                    </td>
                    <td className="py-2 font-mono text-[11px]">
                      {u.channel} / {u.platform}
                    </td>
                    <td className="py-2 font-mono">${u.value.toFixed(2)}</td>
                    <td className="py-2">
                      <span
                        className={cn(
                          "rounded border px-2 py-0.5 font-mono text-[10px]",
                          STATUS_STYLE[u.status],
                        )}
                      >
                        {UPLOAD_STATUS_LABELS[u.status]}
                      </span>
                    </td>
                    <td className="py-2 text-[11px] text-muted-foreground">
                      {u.errorCode ? (ERROR_LABELS[u.errorCode] ?? u.errorCode) : "—"}
                    </td>
                    <td className="py-2 font-mono">{u.attempts}</td>
                    <td className="py-2">
                      <div className="flex gap-2">
                        <button
                          className="text-[11px] text-neon hover:underline"
                          onClick={() => setOpen(open === u.id ? null : u.id)}
                        >
                          {open === u.id ? "收起" : "查看载荷"}
                        </button>
                        {u.status !== "SENT" ? (
                          <button
                            disabled={busy}
                            className="text-[11px] text-muted-foreground hover:underline"
                            onClick={() =>
                              run(
                                () => retryUploadFn({ data: { uploadId: u.id } }),
                                (next) => {
                                  setSnap(next);
                                  toast.success("已重试该条回传");
                                },
                              )
                            }
                          >
                            重试
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                  {open === u.id ? (
                    <tr className="border-b border-border/60 bg-muted/20">
                      <td colSpan={7} className="p-3">
                        <p className="label-mono">request payload</p>
                        <pre className="mt-1 max-h-56 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px]">
                          {JSON.stringify(u.requestPayload, null, 2)}
                        </pre>
                        <p className="label-mono mt-3">response</p>
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-background/60 p-2 font-mono text-[10px]">
                          {JSON.stringify(u.responseBody, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
          {uploads.length === 0 ? (
            <p className="py-8 text-center text-xs text-muted-foreground">暂无回传记录</p>
          ) : null}
        </div>
      </section>
    </AppShell>
  );
}
