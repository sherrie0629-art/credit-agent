import { cn } from "@/lib/utils";
import type { AgentType, Channel, DecisionStatus } from "@/lib/creditagent/types";

const AGENT_STYLES: Record<AgentType, string> = {
  Planner: "border-planner/40 bg-planner/12 text-planner",
  Creative: "border-creative/40 bg-creative/12 text-creative",
  Compliance: "border-compliance/40 bg-compliance/12 text-compliance",
  Execution: "border-execution/40 bg-execution/12 text-execution",
};

export function AgentBadge({ agent, className }: { agent: AgentType; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider",
        AGENT_STYLES[agent],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {agent} Agent
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: Channel }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11px]",
        channel === "Google"
          ? "border-google/40 bg-google/12 text-google"
          : "border-meta/40 bg-meta/12 text-meta",
      )}
    >
      {channel}
    </span>
  );
}

const STATUS_STYLES: Record<DecisionStatus, string> = {
  EXECUTED: "border-success/40 bg-success/12 text-success",
  PENDING_APPROVAL: "border-warning/40 bg-warning/12 text-warning",
  REJECTED_BY_USER: "border-destructive/40 bg-destructive/12 text-destructive",
  ROLLED_BACK: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: DecisionStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-2 py-0.5 font-mono text-[11px]",
        STATUS_STYLES[status],
      )}
    >
      {status}
    </span>
  );
}

export function MetricPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded border border-border bg-background/60 px-2 py-1">
      <span className="label-mono">{label}</span>
      <span
        className={cn(
          "font-mono text-xs",
          tone === "good" && "text-success",
          tone === "bad" && "text-destructive",
          tone === "warn" && "text-warning",
        )}
      >
        {value}
      </span>
    </span>
  );
}
