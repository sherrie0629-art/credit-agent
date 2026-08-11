import { Loader2, ListOrdered, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BattlePlan, BattlePlanItem } from "@/lib/creditagent/battle-plan";
import type { AgentDecision } from "@/lib/creditagent/types";

const PRIORITY_STYLE: Record<string, string> = {
  P0: "border-destructive/50 bg-destructive/15 text-destructive",
  P1: "border-warning/50 bg-warning/15 text-warning",
  P2: "border-border bg-muted/30 text-muted-foreground",
  DEFER: "border-border/60 bg-transparent text-muted-foreground",
};

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span
      className={cn(
        "rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wide",
        PRIORITY_STYLE[priority] ?? PRIORITY_STYLE.P2,
      )}
    >
      {priority}
    </span>
  );
}

export function BattlePlanPanel({
  plan,
  decisions,
  planning,
  approving,
  onGenerate,
  onApproveHighPriority,
}: {
  plan: BattlePlan | null;
  decisions: AgentDecision[];
  planning: boolean;
  approving: boolean;
  onGenerate: () => void;
  onApproveHighPriority: () => void;
}) {
  const byId = new Map(decisions.map((d) => [d.id, d]));
  const highCount = plan?.highPriorityIds.length ?? 0;
  const stillPendingHigh =
    plan?.highPriorityIds.filter((id) => byId.get(id)?.status === "PENDING_APPROVAL").length ?? 0;

  return (
    <section className="panel space-y-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ListOrdered className="size-4 text-neon" />
            <h2 className="text-sm font-semibold tracking-wide">今日作战计划</h2>
            {plan && (
              <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
                {plan.source === "llm" ? "AI 编排" : "启发式回退"}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            AI 只对待审队列排序（先止血再拨付）；一键批准仍逐张过硬编码风控，不发明新动作。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={planning || approving}
            onClick={onGenerate}
            className="text-xs"
          >
            {planning ? <Loader2 className="size-3.5 animate-spin" /> : <ListOrdered className="size-3.5" />}
            生成作战计划
          </Button>
          <Button
            size="sm"
            disabled={planning || approving || stillPendingHigh === 0}
            onClick={onApproveHighPriority}
            className="border border-neon/50 bg-neon/15 text-xs text-neon hover:bg-neon/25"
          >
            {approving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <CheckCheck className="size-3.5" />
            )}
            一键批高优先级{stillPendingHigh > 0 ? ` (${stillPendingHigh})` : ""}
          </Button>
        </div>
      </div>

      {!plan ? (
        <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
          尚未生成。将对当前待审队列做 P0→DEFER 编排；队列为空时可先跑分析师或等扫仓。
        </p>
      ) : (
        <>
          <p className="rounded-md border border-border bg-background/50 px-3 py-2 text-xs leading-relaxed text-foreground/90">
            {plan.summary}
          </p>
          <div className="flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground">
            <span>候选 {plan.candidateCount}</span>
            <span>高优先级 {highCount}</span>
            <span>暂缓 {plan.deferredIds.length}</span>
            <span>{new Date(plan.generatedAt).toLocaleString()}</span>
          </div>
          <ul className="max-h-[280px] space-y-2 overflow-y-auto pr-1">
            {plan.items.map((item) => (
              <BattlePlanRow key={item.decisionId} item={item} decision={byId.get(item.decisionId)} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function BattlePlanRow({
  item,
  decision,
}: {
  item: BattlePlanItem;
  decision?: AgentDecision;
}) {
  const pending = decision?.status === "PENDING_APPROVAL";
  return (
    <li
      className={cn(
        "rounded-md border px-3 py-2",
        item.approveRecommended ? "border-neon/30 bg-neon/5" : "border-border bg-background/40",
        !pending && decision && "opacity-50",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <PriorityBadge priority={item.priority} />
        <span className="font-mono text-[10px] text-muted-foreground">#{item.order + 1}</span>
        {decision ? (
          <span className="text-xs font-medium text-foreground truncate">
            {decision.adGroupName ?? decision.campaignName} · {decision.actionType}
          </span>
        ) : (
          <span className="font-mono text-[11px] text-muted-foreground">{item.decisionId}</span>
        )}
        {decision && !pending && (
          <span className="text-[10px] text-muted-foreground">{decision.status}</span>
        )}
      </div>
      {decision?.effect && (
        <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">{decision.effect}</p>
      )}
      <p className="mt-1 text-[11px] leading-snug text-foreground/80">
        <span className="text-muted-foreground">为何此时批 · </span>
        {item.why}
      </p>
    </li>
  );
}

export function toastBattlePlanResult(
  kind: "generate" | "approve",
  payload: {
    skipped?: string;
    error?: string;
    plan?: BattlePlan;
    executed?: number;
    blocked?: number;
    failed?: number;
    attempted?: number;
  },
) {
  if (payload.skipped === "KILL_SWITCH") {
    toast.warning("全局熔断开启中", { description: "作战计划已跳过" });
    return;
  }
  if (kind === "generate") {
    if (!payload.plan) {
      toast.error("作战计划生成失败", { description: payload.error });
      return;
    }
    if (payload.plan.candidateCount === 0) {
      toast("待审队列为空", { description: payload.plan.summary });
      return;
    }
    toast.success(
      payload.plan.source === "llm" ? "作战计划已生成" : "已用启发式生成作战计划",
      {
        description: `高优先级 ${payload.plan.highPriorityIds.length} 张 · ${payload.plan.summary.slice(0, 80)}`,
      },
    );
    if (payload.error) {
      toast.message("AI 编排回退", { description: payload.error.slice(0, 120) });
    }
    return;
  }
  toast.success("高优先级批量审批完成", {
    description: `尝试 ${payload.attempted ?? 0} · 已执行 ${payload.executed ?? 0} · 未执行/拦截 ${payload.blocked ?? 0} · 失败 ${payload.failed ?? 0}`,
  });
}
