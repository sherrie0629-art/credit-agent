import { useState } from "react";
import { ChevronRight, Check, Undo2, X, CornerDownRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { AgentBadge, ChannelBadge, StatusBadge } from "./badges";
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
  const trigger = decision.dataMetricsTrigger;

  const act = async (kind: "approve" | "reject" | "rollback") => {
    setBusy(true);
    try {
      if (kind === "approve") {
        await agentApi.approveDecision(decision.id);
        toast.success("决策已批准并调用广告 API", { description: decision.effect });
      } else if (kind === "reject") {
        await agentApi.rejectDecision(decision.id);
        toast("决策已被人工否决", { description: "Agent 将在下一轮采集重新评估" });
      } else {
        const to = await agentApi.rollbackDecision(decision.id);
        toast.success("已回滚（Mock API）", { description: `恢复配置：${to}` });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <article
      className={cn(
        "panel scanline relative p-4",
        decision.status === "PENDING_APPROVAL" && "border-warning/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AgentBadge agent={decision.agentType} />
        <ChannelBadge channel={decision.targetChannel} />
        <span className="font-mono text-[11px] text-muted-foreground">
          {decision.actionType}
        </span>
        <span className="ml-auto font-mono text-[11px] text-muted-foreground">
          {new Date(decision.timestamp).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {" · "}
          {decision.id}
        </span>
      </div>

      <h3 className="mt-3 text-sm font-semibold">{decision.campaignName}</h3>
      <p className="mt-1 font-mono text-xs text-neon">{decision.effect}</p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-border bg-background/50 p-2.5">
          <p className="label-mono">trigger · {METRIC_LABEL[trigger.metric]}</p>
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
          <p className="label-mono">confidence</p>
          <div className="mt-2 flex items-center gap-2">
            <Progress value={decision.confidenceScore * 100} className="h-1.5" />
            <span className="font-mono text-xs text-neon">
              {(decision.confidenceScore * 100).toFixed(0)}%
            </span>
          </div>
        </div>
      </div>

      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="mt-3 flex w-full items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-left font-mono text-[11px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground">
          <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
          thought chain · {decision.reasoningChain.length} steps
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
                <CornerDownRight className="size-3" /> rollback snapshot: {decision.rollbackTo}
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
                onClick={() => act("approve")}
                className="border border-success/50 bg-success/15 font-mono text-xs text-success hover:bg-success/25"
              >
                <Check className="size-3.5" /> Approve
              </Button>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => act("reject")}
                className="border border-warning/50 bg-warning/15 font-mono text-xs text-warning hover:bg-warning/25"
              >
                <X className="size-3.5" /> Override
              </Button>
            </>
          )}
          {decision.status === "EXECUTED" && !compact && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => act("rollback")}
              className="font-mono text-xs"
            >
              <Undo2 className="size-3.5" /> Rollback
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}
