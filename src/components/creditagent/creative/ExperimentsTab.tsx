import { useState } from "react";
import { toast } from "sonner";
import { FlaskConical, Loader2 } from "lucide-react";
import { agentApi, useAgentStore } from "@/lib/creditagent/store";
import { cn } from "@/lib/utils";

export function ExperimentsTab() {
  const experiments = useAgentStore((s) => s.experiments);
  const placements = useAgentStore((s) => s.placements);
  const creatives = useAgentStore((s) => s.creatives);
  const [busyId, setBusyId] = useState<string | null>(null);


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
    <div className="space-y-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <FlaskConical className="size-4 text-neon" /> A/B 实验看板
      </h2>

      {experiments.length === 0 && (
        <p className="panel p-4 text-sm text-muted-foreground">
          暂无进行中的实验。请在「素材库与疲劳雷达」中生成变体后勾选并上线 A/B 实验。
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

          <p className="text-[11px] text-muted-foreground">
            <span className="label-mono mr-1.5">原素材</span>
            {creatives.find((c) => c.id === exp.parentCreativeId)?.headline ?? exp.parentCreativeId}
            <span className="label-mono mx-1.5">投放于</span>
            {placements
              .filter((p) => p.creativeId === exp.parentCreativeId && p.status === "ACTIVE")
              .map((p) => `${p.campaignName} › ${p.adGroupName}（${p.channel}）`)
              .join("、") || "未绑定广告系列"}
          </p>
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
    </div>
  );
}
