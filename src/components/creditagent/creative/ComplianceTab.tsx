import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ShieldCheck, Wand2, XCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { agentApi } from "@/lib/creditagent/store";
import { autoFixCompliance, scanCompliance, type ComplianceInput } from "@/lib/creditagent/compliance";
import { cn } from "@/lib/utils";

export function ComplianceTab({
  draft,
  setDraft,
}: {
  draft: ComplianceInput;
  setDraft: (d: ComplianceInput) => void;
}) {
  const [fixLog, setFixLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const result = useMemo(() => scanCompliance(draft), [draft]);

  const scoreTone =
    result.score >= 90 ? "text-success" : result.score >= 60 ? "text-warning" : "text-destructive";

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <section className="panel p-5">
        <h2 className="text-sm font-semibold tracking-wide">素材草稿</h2>
        <div className="mt-4 space-y-4">
          <div>
            <Label className="label-mono">广告标题</Label>
            <Input
              className="mt-2 font-mono text-sm"
              value={draft.headline}
              onChange={(e) => setDraft({ ...draft, headline: e.target.value })}
            />
          </div>
          <div>
            <Label className="label-mono">正文文案</Label>
            <Textarea
              className="mt-2 min-h-40 font-mono text-sm"
              value={draft.bodyText}
              onChange={(e) => setDraft({ ...draft, bodyText: e.target.value })}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="label-mono">还款期限区间</Label>
              <Input
                className="mt-2 font-mono text-sm"
                value={draft.loanTermRange}
                onChange={(e) => setDraft({ ...draft, loanTermRange: e.target.value })}
              />
            </div>
            <div>
              <Label className="label-mono">最高 APR (%)</Label>
              <Input
                type="number"
                step="0.1"
                className="mt-2 font-mono text-sm"
                value={draft.maxApr}
                onChange={(e) => setDraft({ ...draft, maxApr: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border bg-background/50 p-3">
            <div>
              <p className="text-xs">Meta 特殊广告类别</p>
              <p className="text-[11px] text-muted-foreground">
                金融产品与服务（Financial Products and Services）
              </p>
            </div>
            <Switch
              checked={draft.specialAdCategory}
              onCheckedChange={(v) => setDraft({ ...draft, specialAdCategory: v })}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              className="border border-neon/50 bg-neon/15 text-xs text-neon hover:bg-neon/25"
              onClick={() => {
                const { next, changes } = autoFixCompliance(draft);
                setDraft(next);
                setFixLog(changes);
                toast.success("Compliance Agent 已自动改写", {
                  description: `已应用 ${changes.length} 项合规修复`,
                });
              }}
            >
              <Wand2 className="size-3.5" /> 一键合规修复
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              className="text-xs"
              onClick={async () => {
                setBusy(true);
                try {
                  await agentApi.logComplianceDecision({
                    headline: draft.headline,
                    blocked: result.blocked,
                    score: result.score,
                    reasons: result.rules
                      .filter((r) => !r.passed)
                      .map((r) => `[${r.source}] ${r.label} — ${r.detail}`),
                  });
                  if (result.blocked) {
                    toast.error("提交已被合规 Agent 阻断", {
                      description: "存在严重违规项，请先执行一键合规修复",
                    });
                  } else {
                    toast.success("素材已通过合规审计并送审广告 API");
                  }
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Send className="size-3.5" /> 提交至广告 API
            </Button>
          </div>

          {fixLog.length > 0 && (
            <div className="rounded-md border border-neon/30 bg-neon/5 p-3">
              <p className="label-mono">自动修复记录</p>
              <ul className="mt-2 space-y-1">
                {fixLog.map((c, i) => (
                  <li key={i} className="font-mono text-[11px] text-foreground/85">
                    + {c}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex items-center gap-3">
          <ShieldCheck className="size-4 text-neon" />
          <h2 className="text-sm font-semibold tracking-wide">实时合规扫描</h2>
        </div>

        <div className="mt-4 rounded-md border border-border bg-background/50 p-4">
          <div className="flex items-end justify-between">
            <p className="label-mono">合规评分</p>
            <p className={cn("font-mono text-3xl font-semibold", scoreTone)}>
              {result.score}
              <span className="text-sm text-muted-foreground">/100</span>
            </p>
          </div>
          <Progress value={result.score} className="mt-3 h-2" />
          <p
            className={cn(
              "mt-3 text-xs",
              result.status === "PASSED"
                ? "text-success"
                : result.status === "WARNING"
                  ? "text-warning"
                  : "text-destructive",
            )}
          >
            审核结论：
            {result.status === "PASSED"
              ? "通过"
              : result.status === "WARNING"
                ? "存在风险提示"
                : "未通过"}
            {result.blocked && " · 提交已被阻断"}
          </p>
        </div>

        <ul className="mt-4 space-y-2">
          {result.rules.map((r) => (
            <li
              key={r.id}
              className={cn(
                "rounded-md border p-3",
                r.passed
                  ? "border-success/30 bg-success/5"
                  : r.severity === "CRITICAL"
                    ? "border-destructive/40 bg-destructive/8"
                    : "border-warning/40 bg-warning/8",
              )}
            >
              <div className="flex items-start gap-2">
                {r.passed ? (
                  <CheckCircle2 className="mt-0.5 size-4 text-success" />
                ) : r.severity === "CRITICAL" ? (
                  <XCircle className="mt-0.5 size-4 text-destructive" />
                ) : (
                  <AlertTriangle className="mt-0.5 size-4 text-warning" />
                )}
                <div className="min-w-0">
                  <p className="text-sm">
                    <span className="label-mono mr-2">{r.source}</span>
                    {r.label}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{r.detail}</p>
                </div>
                <span className="ml-auto font-mono text-[11px] text-muted-foreground">
                  {r.passed ? `+${r.weight}` : `0/${r.weight}`}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
