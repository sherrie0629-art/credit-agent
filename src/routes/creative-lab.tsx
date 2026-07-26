import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FlaskConical,
  ImageIcon,
  Loader2,
  RadarIcon,
  Rocket,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { AppShell } from "@/components/creditagent/AppShell";
import { agentApi, useAgentStore } from "@/lib/creditagent/store";
import { computeFatigue, FATIGUE_LEVEL_LABEL, type FatigueLevel } from "@/lib/creditagent/fatigue";
import { VARIANT_STATUS_LABEL } from "@/lib/creditagent/creative-types";
import { streamImage } from "@/lib/streamImage";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/creative-lab")({
  component: CreativeLab,
  head: () => ({
    meta: [
      { title: "创意实验室 · 广告疲劳预警与自动迭代 | CreditAgent AI" },
      {
        name: "description",
        content:
          "Creative Agent 自动巡检广告疲劳信号，生成合规文案与视觉变体，并通过 A/B 赛马自动淘汰低效素材。",
      },
      { property: "og:title", content: "创意实验室 · 广告疲劳预警与自动迭代" },
      {
        property: "og:description",
        content: "疲劳雷达、AI 变体生成与实验看板，全流程白盒可追溯。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

const LEVEL_STYLE: Record<FatigueLevel, string> = {
  HEALTHY: "border-success/40 bg-success/12 text-success",
  WATCH: "border-warning/40 bg-warning/12 text-warning",
  FATIGUED: "border-destructive/40 bg-destructive/12 text-destructive",
};

function CreativeLab() {
  const creatives = useAgentStore((s) => s.creatives);
  const metrics = useAgentStore((s) => s.creativeMetrics);
  const variants = useAgentStore((s) => s.variants);
  const experiments = useAgentStore((s) => s.experiments);
  const loaded = useAgentStore((s) => s.loaded);

  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, { src: string; final: boolean }>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const fatigueByCreative = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeFatigue>>();
    for (const c of creatives) {
      map.set(
        c.id,
        computeFatigue(metrics.filter((m) => m.creativeId === c.id)),
      );
    }
    return map;
  }, [creatives, metrics]);

  async function handleScan() {
    setScanning(true);
    try {
      const alerts = await agentApi.scanFatigue();
      toast.success(
        alerts.length
          ? `巡检完成：${alerts.length} 条素材判定为已疲劳，已写入决策流`
          : "巡检完成：暂无疲劳素材",
      );
    } catch {
      toast.error("巡检失败，请稍后重试");
    } finally {
      setScanning(false);
    }
  }

  async function handleGenerate(creativeId: string) {
    setBusyId(creativeId);
    try {
      const created = await agentApi.generateVariants(creativeId);
      toast.success(`AI 已生成 ${created} 个候选变体，并完成合规审计`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      toast.error(
        msg.includes("RATE_LIMIT")
          ? "AI 网关限流，请稍后重试"
          : msg.includes("NO_CREDITS")
            ? "AI 额度已用尽，请在工作区补充额度"
            : "变体生成失败，请稍后重试",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleImage(variantId: string, prompt: string) {
    setImgBusy(variantId);
    try {
      let last = "";
      await streamImage("/api/generate-creative-image", prompt, (src, final) => {
        last = src;
        setPreview((p) => ({ ...p, [variantId]: { src, final } }));
      });
      await agentApi.setVariantImage(variantId, last);
      toast.success("变体主视觉已生成并保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "配图生成失败");
    } finally {
      setImgBusy(null);
    }
  }

  async function handleLaunch(creativeId: string) {
    const ids = variants
      .filter((v) => v.parentCreativeId === creativeId && selected[v.id])
      .map((v) => v.id);
    if (ids.length === 0) {
      toast.error("请先勾选要上线的变体");
      return;
    }
    setBusyId(creativeId);
    try {
      const res = await agentApi.launchExperiment(creativeId, ids);
      toast.success(
        res.mode === "FULL_AUTO"
          ? `实验已上线（Full-Auto），${ids.length} 个变体开始赛马`
          : `实验已创建（Semi-Auto），${ids.length} 个变体待人工审批`,
      );
      setSelected({});
    } catch {
      toast.error("实验上线失败");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSettle(experimentId: string) {
    setBusyId(experimentId);
    try {
      const res = await agentApi.settleExperiment(experimentId);
      if (res.decided) toast.success(res.message);
      else toast.info(res.message);
    } catch {
      toast.error("实验推进失败");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-mono">module 05</p>
            <h1 className="text-2xl font-semibold tracking-tight">创意实验室</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Creative Agent 自动巡检广告疲劳，生成合规变体并通过 A/B 赛马淘汰低效素材。
            </p>
          </div>
          <button
            onClick={handleScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 rounded-md border border-neon/50 bg-neon/10 px-4 py-2 text-sm font-medium text-neon transition-colors hover:bg-neon/20 disabled:opacity-50"
          >
            {scanning ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RadarIcon className="size-4" />
            )}
            立即巡检疲劳
          </button>
        </header>

        {!loaded && <p className="text-sm text-muted-foreground">正在加载素材指标…</p>}

        {/* 疲劳雷达 */}
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TrendingDown className="size-4 text-neon" /> 疲劳雷达
          </h2>

          {creatives.map((c) => {
            const f = fatigueByCreative.get(c.id);
            const level = (f?.level ?? c.fatigueLevel) as FatigueLevel;
            const score = f?.score ?? c.fatigueScore;
            const own = variants.filter((v) => v.parentCreativeId === c.id);
            const exp = experiments.find((e) => e.parentCreativeId === c.id);

            return (
              <article key={c.id} className="panel space-y-4 p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded border px-2 py-0.5 text-[11px]",
                          LEVEL_STYLE[level],
                        )}
                      >
                        {FATIGUE_LEVEL_LABEL[level]} · {score}/100
                      </span>
                      <span className="label-mono">{c.id}</span>
                    </div>
                    <p className="mt-2 truncate text-sm font-medium">{c.headline}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.bodyText}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleGenerate(c.id)}
                      disabled={busyId === c.id}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-xs transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                    >
                      {busyId === c.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="size-3.5" />
                      )}
                      AI 生成变体
                    </button>
                    <button
                      onClick={() => handleLaunch(c.id)}
                      disabled={busyId === c.id}
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-xs transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                    >
                      <Rocket className="size-3.5" />
                      上线 A/B 实验
                    </button>
                  </div>
                </div>

                <div className="h-1.5 w-full overflow-hidden rounded bg-muted">
                  <div
                    className={cn(
                      "h-full rounded transition-all",
                      level === "FATIGUED"
                        ? "bg-destructive"
                        : level === "WATCH"
                          ? "bg-warning"
                          : "bg-success",
                    )}
                    style={{ width: `${score}%` }}
                  />
                </div>

                <ul className="grid gap-2 sm:grid-cols-2">
                  {(f?.signals ?? []).map((s) => (
                    <li
                      key={s.id}
                      className={cn(
                        "rounded border px-3 py-2 text-[11px]",
                        s.hit
                          ? "border-destructive/30 bg-destructive/8 text-foreground"
                          : "border-border bg-background/40 text-muted-foreground",
                      )}
                    >
                      <span className="font-medium">
                        {s.hit ? "命中" : "正常"} · {s.label}（权重 {s.weight}）
                      </span>
                      <span className="mt-0.5 block">{s.detail}</span>
                    </li>
                  ))}
                </ul>

                {own.length > 0 && (
                  <div className="space-y-3 border-t border-border pt-3">
                    <p className="label-mono">ai 变体 · {own.length}</p>
                    <div className="grid gap-3 lg:grid-cols-3">
                      {own.map((v) => {
                        const p = preview[v.id];
                        const img = p?.src ?? v.imageUrl;
                        return (
                          <div key={v.id} className="rounded border border-border bg-background/50 p-3">
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                className="accent-[var(--color-neon,#22d3ee)]"
                                checked={!!selected[v.id]}
                                disabled={v.status === "BLOCKED"}
                                onChange={(e) =>
                                  setSelected((s) => ({ ...s, [v.id]: e.target.checked }))
                                }
                              />
                              <span
                                className={cn(
                                  "rounded border px-1.5 py-0.5 text-[10px]",
                                  v.complianceStatus === "PASSED"
                                    ? "border-success/40 text-success"
                                    : v.complianceStatus === "WARNING"
                                      ? "border-warning/40 text-warning"
                                      : "border-destructive/40 text-destructive",
                                )}
                              >
                                合规 {v.complianceScore}/100
                              </span>
                              <span className="ml-auto label-mono">
                                {VARIANT_STATUS_LABEL[v.status]}
                              </span>
                            </div>

                            {img && (
                              <img
                                src={img}
                                alt={`变体主视觉：${v.angle}`}
                                className={cn(
                                  "mt-2 aspect-video w-full rounded object-cover transition-[filter]",
                                  p && !p.final ? "blur-xl" : "blur-0",
                                )}
                              />
                            )}

                            <p className="mt-2 text-[11px] text-neon">{v.angle}</p>
                            <p className="mt-1 text-xs font-medium">{v.headline}</p>
                            <p className="mt-1 line-clamp-4 text-[11px] text-muted-foreground">
                              {v.bodyText}
                            </p>

                            <button
                              onClick={() => handleImage(v.id, `${v.angle}. ${v.headline}`)}
                              disabled={imgBusy === v.id}
                              className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded border border-border px-2 py-1.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                            >
                              {imgBusy === v.id ? (
                                <Loader2 className="size-3 animate-spin" />
                              ) : (
                                <ImageIcon className="size-3" />
                              )}
                              {img ? "重新生成主视觉" : "生成主视觉"}
                            </button>

                            {v.complianceLogs.length > 0 && (
                              <ul className="mt-2 space-y-0.5">
                                {v.complianceLogs.map((log, i) => (
                                  <li key={i} className="text-[10px] text-muted-foreground">
                                    · {log}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {exp && (
                  <p className="text-[11px] text-muted-foreground">
                    当前实验：{exp.id}（{exp.status === "RUNNING" ? "赛马中" : "已结束"}）
                  </p>
                )}
              </article>
            );
          })}
        </section>

        {/* 实验看板 */}
        <section className="space-y-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <FlaskConical className="size-4 text-neon" /> 实验看板
          </h2>

          {experiments.length === 0 && (
            <p className="panel p-4 text-sm text-muted-foreground">
              暂无进行中的实验。生成变体后勾选并点击「上线 A/B 实验」。
            </p>
          )}

          {experiments.map((exp) => (
            <article key={exp.id} className="panel space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="label-mono">{exp.id}</span>
                <span
                  className={cn(
                    "rounded border px-2 py-0.5 text-[11px]",
                    exp.status === "RUNNING"
                      ? "border-warning/40 bg-warning/12 text-warning"
                      : "border-success/40 bg-success/12 text-success",
                  )}
                >
                  {exp.status === "RUNNING" ? "赛马中" : "已判定"}
                </span>
                <button
                  onClick={() => handleSettle(exp.id)}
                  disabled={exp.status === "DECIDED" || busyId === exp.id}
                  className="ml-auto inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-40"
                >
                  {busyId === exp.id ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <FlaskConical className="size-3.5" />
                  )}
                  推进并结算
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-muted-foreground">
                    <tr>
                      <th className="py-1.5 pr-3 font-normal">投放臂</th>
                      <th className="py-1.5 pr-3 font-normal">曝光</th>
                      <th className="py-1.5 pr-3 font-normal">CTR</th>
                      <th className="py-1.5 pr-3 font-normal">CPL</th>
                      <th className="py-1.5 pr-3 font-normal">CPS</th>
                      <th className="py-1.5 pr-3 font-normal">放款</th>
                      <th className="py-1.5 pr-3 font-normal">置信度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {exp.armStats.map((a) => (
                      <tr
                        key={a.armId}
                        className={cn(
                          "border-t border-border",
                          exp.winnerVariantId === a.armId && "text-success",
                        )}
                      >
                        <td className="py-1.5 pr-3">
                          {a.label}
                          {exp.winnerVariantId === a.armId && " · 胜出"}
                        </td>
                        <td className="py-1.5 pr-3 font-mono">{a.impressions.toLocaleString()}</td>
                        <td className="py-1.5 pr-3 font-mono">{(a.ctr * 100).toFixed(2)}%</td>
                        <td className="py-1.5 pr-3 font-mono">${a.cpl.toFixed(2)}</td>
                        <td className="py-1.5 pr-3 font-mono">${a.cps.toFixed(2)}</td>
                        <td className="py-1.5 pr-3 font-mono">{a.loans}</td>
                        <td className="py-1.5 pr-3 font-mono">
                          {a.kind === "CONTROL" ? "—" : `${(a.confidence * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="text-[11px] text-muted-foreground">
                判定条件：单臂曝光 ≥ 1,000 且相对对照组置信度 ≥ 95%，按 CPS 最低者胜出并全量承接预算。
              </p>
            </article>
          ))}
        </section>
      </div>
    </AppShell>
  );
}
