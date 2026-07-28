import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ImageIcon,
  Loader2,
  RadarIcon,
  Rocket,
  ShieldCheck,
  Sparkles,
  TrendingDown,
} from "lucide-react";
import { agentApi, useAgentStore } from "@/lib/creditagent/store";
import { computeFatigue, FATIGUE_LEVEL_LABEL, type FatigueLevel } from "@/lib/creditagent/fatigue";
import { VARIANT_STATUS_LABEL } from "@/lib/creditagent/creative-types";
import type { ComplianceInput } from "@/lib/creditagent/compliance";
import type { CreativePlacement } from "@/lib/creditagent/types";
import { streamImage } from "@/lib/streamImage";
import { cn } from "@/lib/utils";


const LEVEL_STYLE: Record<FatigueLevel, string> = {
  HEALTHY: "border-success/40 bg-success/12 text-success",
  WATCH: "border-warning/40 bg-warning/12 text-warning",
  FATIGUED: "border-destructive/40 bg-destructive/12 text-destructive",
};

export function CreativeLibraryTab({
  onReview,
}: {
  onReview: (draft: ComplianceInput) => void;
}) {
  const creatives = useAgentStore((s) => s.creatives);
  const metrics = useAgentStore((s) => s.creativeMetrics);
  const variants = useAgentStore((s) => s.variants);
  const experiments = useAgentStore((s) => s.experiments);
  const loaded = useAgentStore((s) => s.loaded);
  const placements = useAgentStore((s) => s.placements);

  const [scanning, setScanning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<Record<string, { src: string; final: boolean }>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});

  const placementsByCreative = useMemo(() => {
    const map = new Map<string, CreativePlacement[]>();
    for (const p of placements) {
      const list = map.get(p.creativeId) ?? [];
      list.push(p);
      map.set(p.creativeId, list);
    }
    return map;
  }, [placements]);

  const fatigueByCreative = useMemo(() => {
    const map = new Map<string, ReturnType<typeof computeFatigue>>();
    for (const c of creatives) {
      map.set(c.id, computeFatigue(metrics.filter((m) => m.creativeId === c.id)));
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <TrendingDown className="size-4 text-neon" /> 素材库与疲劳雷达
        </h2>
        <button
          onClick={handleScan}
          disabled={scanning}
          className="inline-flex items-center gap-2 rounded-md border border-neon/50 bg-neon/10 px-4 py-2 text-sm font-medium text-neon transition-colors hover:bg-neon/20 disabled:opacity-50"
        >
          {scanning ? <Loader2 className="size-4 animate-spin" /> : <RadarIcon className="size-4" />}
          立即巡检疲劳
        </button>
      </div>

      {!loaded && <p className="text-sm text-muted-foreground">正在加载素材指标…</p>}

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
                  <span
                    className={cn(
                      "rounded border px-2 py-0.5 text-[11px]",
                      c.complianceStatus === "PASSED"
                        ? "border-success/40 bg-success/12 text-success"
                        : c.complianceStatus === "WARNING"
                          ? "border-warning/40 bg-warning/12 text-warning"
                          : "border-destructive/40 bg-destructive/12 text-destructive",
                    )}
                  >
                    合规{" "}
                    {c.complianceStatus === "PASSED"
                      ? "已通过"
                      : c.complianceStatus === "WARNING"
                        ? "风险提示"
                        : "未通过"}
                  </span>
                  <span className="label-mono">{c.id}</span>
                </div>
                <p className="mt-2 truncate text-sm font-medium">{c.headline}</p>
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{c.bodyText}</p>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {c.loanTermRange} · 最高 APR {c.maxApr || "—"}%
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="label-mono">投放于</span>
                  {placementsByCreative.get(c.id)?.length ? (
                    placementsByCreative.get(c.id)!.map((p) => (
                      <Link
                        key={p.campaignId}
                        to="/campaigns"
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon",
                          p.status === "ACTIVE"
                            ? "border-border bg-background/60"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                      >
                        <span className="font-mono text-[10px] opacity-70">{p.channel}</span>
                        {p.campaignName}
                        <span className="font-mono text-[10px] text-neon">
                          {p.status === "ACTIVE" ? `${(p.share * 100).toFixed(0)}%` : "已暂停"}
                        </span>
                      </Link>
                    ))
                  ) : (
                    <span className="text-[11px] text-muted-foreground">未绑定广告系列</span>
                  )}
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 rounded border border-border bg-background/40 px-2.5 py-1.5">
                  <span className="label-mono">后端表现</span>
                  {c.backend && c.backend.leads > 0 ? (
                    <>
                      <span className="font-mono text-[11px]">
                        线索{" "}
                        <span className="text-foreground">{c.backend.leads.toLocaleString()}</span>
                      </span>
                      <span className="font-mono text-[11px]">
                        授信通过率{" "}
                        <span
                          className={cn(
                            c.backend.approvalRate < 0.1 ? "text-destructive" : "text-success",
                          )}
                        >
                          {(c.backend.approvalRate * 100).toFixed(1)}%
                        </span>
                      </span>
                      <span className="font-mono text-[11px]">
                        放款{" "}
                        <span className="text-foreground">{c.backend.disbursedCount}</span> 笔
                      </span>
                      <span className="font-mono text-[11px]">
                        CPS{" "}
                        <span className={cn(c.backend.cps > 19 ? "text-destructive" : "text-success")}>
                          ${c.backend.cps.toFixed(2)}
                        </span>
                      </span>
                    </>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">暂无后端线索数据</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() =>
                    onReview({
                      headline: c.headline,
                      bodyText: c.bodyText,
                      loanTermRange: c.loanTermRange,
                      maxApr: c.maxApr,
                      specialAdCategory: c.complianceStatus === "PASSED",
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-md border border-border bg-background/60 px-3 py-2 text-xs transition-colors hover:border-neon/50 hover:text-neon"
                >
                  <ShieldCheck className="size-3.5" />
                  送去合规审查
                </button>
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
                          <span className="ml-auto label-mono">{VARIANT_STATUS_LABEL[v.status]}</span>
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

                        <div className="mt-3 grid gap-2">
                          <button
                            onClick={() => handleImage(v.id, `${v.angle}. ${v.headline}`)}
                            disabled={imgBusy === v.id}
                            className="inline-flex w-full items-center justify-center gap-2 rounded border border-border px-2 py-1.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon disabled:opacity-50"
                          >
                            {imgBusy === v.id ? (
                              <Loader2 className="size-3 animate-spin" />
                            ) : (
                              <ImageIcon className="size-3" />
                            )}
                            {img ? "重新生成主视觉" : "生成主视觉"}
                          </button>
                          <button
                            onClick={() =>
                              onReview({
                                headline: v.headline,
                                bodyText: v.bodyText,
                                loanTermRange: c.loanTermRange,
                                maxApr: c.maxApr,
                                specialAdCategory: v.complianceStatus === "PASSED",
                              })
                            }
                            className="inline-flex w-full items-center justify-center gap-2 rounded border border-border px-2 py-1.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon"
                          >
                            <ShieldCheck className="size-3" />
                            送去合规审查
                          </button>
                        </div>

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
    </div>
  );
}
