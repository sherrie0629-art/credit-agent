import { useEffect, useState } from "react";
import { ChevronRight, Check, Undo2, X, CornerDownRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AgentBadge, ChannelBadge, StatusBadge } from "./badges";
import { toastForExternal } from "@/lib/creditagent/google-ads";
import { agentApi } from "@/lib/creditagent/store";
import type { AgentDecision } from "@/lib/creditagent/types";
import { cn } from "@/lib/utils";

const METRIC_LABEL: Record<AgentDecision["dataMetricsTrigger"]["metric"], string> = {
  CPL: "表单成本 CPL",
  ApprovalRate: "后端授信通过率",
  CostPerDisbursement: "实际放款成本 CPS",
  ROAS: "30 天 ROAS",
};

function fmtMetric(metric: string, v: number) {
  if (metric === "ApprovalRate") return `${(v * 100).toFixed(1)}%`;
  if (metric === "ROAS") return `${v.toFixed(2)}x`;
  return `$${v.toFixed(2)}`;
}

export function DecisionCard({
  decision,
  compact = false,
}: {
  decision: AgentDecision;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyKind, setBusyKind] = useState<"approve" | "reject" | "rollback" | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const trigger = decision.dataMetricsTrigger;

  useEffect(() => {
    if (!busy || busyKind !== "approve") {
      setElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const tick = () => setElapsedSec(Math.round((Date.now() - startedAt) / 1000));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [busy, busyKind]);

  const act = async (kind: "approve" | "reject" | "rollback") => {
    if (busy) return;
    setBusy(true);
    setBusyKind(kind);
    let loadingToastId: string | number | undefined;
    try {
      if (kind === "approve") {
        loadingToastId = toast.loading("正在推送 Google…", {
          description: decision.effect,
        });
        const external = await agentApi.approveDecision(decision.id);
        const t = toastForExternal(external);
        const description = [decision.effect, t.description].filter(Boolean).join(" · ");
        if (t.kind === "error") toast.error(t.title, { id: loadingToastId, description });
        else if (t.kind === "success") toast.success(t.title, { id: loadingToastId, description });
        else toast(t.title, { id: loadingToastId, description });
      } else if (kind === "reject") {
        await agentApi.rejectDecision(decision.id);
        toast("决策已被人工否决", { description: "Agent 将在下一轮采集重新评估" });
      } else {
        const to = await agentApi.rollbackDecision(decision.id);
        toast.success("已回滚（仅本地）", { description: `恢复配置：${to}` });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const opts = loadingToastId !== undefined ? { id: loadingToastId, description: msg } : { description: msg };
      if (msg.includes("GOOGLE_ADS_UNBOUND") || msg.includes("Google Ads") || msg.includes("Google 未响应")) {
        toast.error("未推送 Google", {
          ...opts,
          description: msg.replace(/^GOOGLE_ADS_UNBOUND:/, ""),
        });
      } else {
        toast.error("操作失败", opts);
      }
    } finally {
      setBusy(false);
      setBusyKind(null);
    }
  };

  const approving = busy && busyKind === "approve";

  return (
    <article
      className={cn(
        "panel scanline relative p-4 transition-opacity",
        decision.status === "PENDING_APPROVAL" && "border-warning/40",
        approving && "pointer-events-none opacity-70",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AgentBadge agent={decision.agentType} />
        <ChannelBadge channel={decision.targetChannel} />
        <span className="font-mono text-[11px] text-muted-foreground">
          {decision.actionType}
        </span>
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[10px]",
            decision.triggerSource === "LLM"
              ? "border-neon/50 bg-neon/10 text-neon"
              : decision.triggerSource === "SWEEP"
                ? "border-warning/40 text-warning"
                : "border-border text-muted-foreground",
          )}
        >
          {decision.triggerSource === "LLM"
            ? "AI 参谋建议"
            : decision.triggerSource === "SWEEP"
              ? "定时巡检兜底"
              : "事件驱动"}
        </span>
        {approving && (
          <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-700 dark:text-sky-300">
            执行中 · {elapsedSec}s
          </span>
        )}

        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {new Date(decision.timestamp).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {" · "}
          {decision.id}
        </span>
      </div>

      <h3 className="mt-3 text-sm font-semibold">
        <span className="label-mono mr-1.5">广告系列</span>
        {decision.campaignName}
      </h3>
      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="label-mono">投放层级</span>
        <span>{decision.campaignName}</span>
        <span className="opacity-60">›</span>
        <span className={decision.adGroupName ? "text-foreground" : ""}>
          {decision.adGroupName ?? "全系列"}
        </span>
        {decision.creativeName && (
          <>
            <span className="opacity-60">›</span>
            <span className="text-foreground">{decision.creativeName}</span>
            <span className="font-mono text-[10px] opacity-70">{decision.creativeId}</span>
          </>
        )}
      </p>
      <p className="mt-1 font-mono text-xs text-neon">{decision.effect}</p>

      {approving && (
        <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          正在推送 Google… {elapsedSec}s（跨境 API，通常数秒）
        </p>
      )}

      {decision.triggerSource === "LLM" && (
        <p className="mt-2 rounded-md border border-neon/40 bg-neon/8 p-2 text-[11px] text-neon">
          本条为 AI 参谋提出的<strong>未经验证假设</strong>，不会自动执行；即使人工批准，仍需通过硬编码风控规则层。
        </p>
      )}

      {decision.guardrailNote && (
        <p className="mt-2 rounded-md border border-warning/40 bg-warning/8 p-2 text-[11px] text-warning">
          风控规则层：{decision.guardrailNote}
        </p>
      )}

      {decision.externalMutateDetail && (
        <p className="mt-2 rounded-md border border-border p-2 font-mono text-[11px] text-muted-foreground">
          Google Ads：{decision.externalMutateStatus ?? "—"} · {decision.externalMutateDetail}
        </p>
      )}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-background/50 p-2.5">
          <p className="label-mono">触发指标 · {METRIC_LABEL[trigger.metric]}</p>
          <p className="mt-1 font-mono text-xs">
            <span
              className={cn(
                trigger.metric === "ApprovalRate" || trigger.metric === "ROAS"
                  ? trigger.currentValue < trigger.thresholdValue
                    ? "text-destructive"
                    : "text-success"
                  : trigger.currentValue > trigger.thresholdValue
                    ? "text-destructive"
                    : "text-success",
              )}
            >
              {fmtMetric(trigger.metric, trigger.currentValue)}
            </span>
            <span className="text-muted-foreground">
              {" vs 阈值 "}
              {fmtMetric(trigger.metric, trigger.thresholdValue)}
            </span>
          </p>
        </div>
        <div className="rounded-md border border-border bg-background/50 p-2.5">
          <p className="label-mono">决策置信度</p>
          <div className="mt-2 flex items-center gap-2">
            <Progress value={decision.confidenceScore * 100} className="h-1.5" />
            <span className="font-mono text-xs text-neon">
              {(decision.confidenceScore * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      {impact.length > 0 && (
        <Collapsible open={impactOpen} onOpenChange={setImpactOpen}>
          <CollapsibleTrigger className="mt-3 flex w-full items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-left text-[11px] tracking-wide text-muted-foreground transition-colors hover:text-foreground">
            <ChevronRight className={cn("size-3.5 transition-transform", impactOpen && "rotate-90")} />
            影响面 · 将改动 {impact.length} 处实体字段
            {decision.ontologyBefore ? ` · 关联实体 ${decision.ontologyBefore.nodes.length}` : ""}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 space-y-1.5">
              {impact.map((c, i) => (
                <li
                  key={`${c.type}-${c.id}-${c.field}-${i}`}
                  className="rounded-md border border-border bg-background/40 px-2.5 py-1.5 font-mono text-[11px] text-foreground/85"
                >
                  {describeChange(c)}
                </li>
              ))}
            </ul>
            {decision.ontologyBefore?.truncated && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                子图快照已截断，仅保留最相关的一部分实体。
              </p>
            )}
          </CollapsibleContent>
        </Collapsible>
      )}

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="mt-3 flex w-full items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-left text-[11px] tracking-wide text-muted-foreground transition-colors hover:text-foreground">
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          推理链 · 共 {decision.reasoningChain.length} 步
        </CollapsibleTrigger>

        <CollapsibleContent>
          <ol className="mt-2 space-y-2 border-l border-border pl-4">
            {decision.reasoningChain.map((step, i) => (
              <li key={i} className="relative font-mono text-xs leading-relaxed text-muted-foreground">
                <span className="absolute -left-[21px] top-1.5 size-1.5 rounded-full bg-neon/70" />
                <span className="text-neon">{String(i + 1).padStart(2, "0")}</span>{" "}
                <span className="text-foreground/85">{step}</span>
              </li>
            ))}
            {decision.rollbackTo && (
              <li className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                <CornerDownRight className="size-3" /> 回滚快照：{decision.rollbackTo}
              </li>
            )}
          </ol>
        </CollapsibleContent>
      </Collapsible>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={decision.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          {decision.status === "PENDING_APPROVAL" && (
            <>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void act("approve")}
                className="border border-success/50 bg-success/15 text-xs text-success hover:bg-success/25"
              >
                {approving ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Check className="size-3.5" />
                )}{" "}
                {approving ? `正在推送 Google… ${elapsedSec}s` : "批准执行"}
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void act("reject")}
                className="border border-warning/50 bg-warning/15 text-xs text-warning hover:bg-warning/25"
              >
                <X className="size-3.5" /> 人工否决
              </Button>
            </>
          )}
          {decision.status === "EXECUTED" && !compact && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void act("rollback")}
              className="text-xs"
            >
              <Undo2 className="size-3.5" /> 一键回滚
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
