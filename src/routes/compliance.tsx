import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, ShieldCheck, Wand2, XCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/creditagent/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { agentApi, useAgentStore } from "@/lib/creditagent/store";
import { autoFixCompliance, scanCompliance, type ComplianceInput } from "@/lib/creditagent/compliance";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/compliance")({
  head: () => ({
    meta: [
      { title: "金融合规与素材实验室 | CreditAgent AI" },
      {
        name: "description",
        content:
          "实时 Compliance Score 扫描 Google Personal Loans Policy 与 Meta 金融特殊广告类别，一键 Auto-Fix 追加 APR 披露与免责声明。",
      },
      { property: "og:title", content: "金融合规与素材实验室 | CreditAgent AI" },
      {
        property: "og:description",
        content: "禁词拦截、还款期限 ≥ 61 天校验、APR ≤ 36% 校验与自动合规改写。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CompliancePage,
});

function CompliancePage() {
  const creatives = useAgentStore((s) => s.creatives);
  const [draft, setDraft] = useState<ComplianceInput>({
    headline: "100% Approval — No Credit Check!",
    bodyText:
      "Instant approval without income proof. Get money in your account today, guaranteed.",
    loanTermRange: "—",
    maxApr: 0,
    specialAdCategory: false,
  });
  const [fixLog, setFixLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const result = useMemo(() => scanCompliance(draft), [draft]);

  const scoreTone =
    result.score >= 90 ? "text-success" : result.score >= 60 ? "text-warning" : "text-destructive";

  return (
    <AppShell>
      <header className="panel p-5">
        <p className="label-mono">module 03</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">
          金融合规与素材实验室
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          金融合规自愈盾 · 所有素材提交广告 API 前强制经过 Compliance Agent 审计
        </p>
      </header>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
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
                className="border border-neon/50 bg-neon/15 font-mono text-xs text-neon hover:bg-neon/25"
                onClick={() => {
                  const { next, changes } = autoFixCompliance(draft);
                  setDraft(next);
                  setFixLog(changes);
                  toast.success("Compliance Agent 已自动改写", {
                    description: `${changes.length} 项修复已应用`,
                  });
                }}
              >
                <Wand2 className="size-3.5" /> 一键合规修复 Auto-Fix
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                className="font-mono text-xs"
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
                        description: "存在 CRITICAL 违规项，请先执行 Auto-Fix",
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
                <p className="label-mono">auto-fix log</p>
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
            <h2 className="font-mono text-sm uppercase tracking-widest">
              Real-time Compliance Scanner
            </h2>
          </div>

          <div className="mt-4 rounded-md border border-border bg-background/50 p-4">
            <div className="flex items-end justify-between">
              <p className="label-mono">compliance score</p>
              <p className={cn("font-mono text-3xl font-semibold", scoreTone)}>
                {result.score}
                <span className="text-sm text-muted-foreground">/100</span>
              </p>
            </div>
            <Progress value={result.score} className="mt-3 h-2" />
            <p
              className={cn(
                "mt-3 font-mono text-xs",
                result.status === "PASSED"
                  ? "text-success"
                  : result.status === "WARNING"
                    ? "text-warning"
                    : "text-destructive",
              )}
            >
              STATUS = {result.status}
              {result.blocked && " · 提交已阻断（Submission Blocked）"}
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

      <section className="panel mt-4 p-5">
        <h2 className="font-mono text-sm uppercase tracking-widest">Creative Library</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          {creatives.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() =>
                setDraft({
                  headline: c.headline,
                  bodyText: c.bodyText,
                  loanTermRange: c.loanTermRange,
                  maxApr: c.maxApr,
                  specialAdCategory: c.complianceStatus === "PASSED",
                })
              }
              className="rounded-md border border-border bg-background/50 p-4 text-left transition-colors hover:border-neon/40"
            >
              <div className="flex items-center justify-between">
                <span className="label-mono">{c.id}</span>
                <span
                  className={cn(
                    "rounded border px-2 py-0.5 font-mono text-[11px]",
                    c.complianceStatus === "PASSED"
                      ? "border-success/40 bg-success/12 text-success"
                      : c.complianceStatus === "WARNING"
                        ? "border-warning/40 bg-warning/12 text-warning"
                        : "border-destructive/40 bg-destructive/12 text-destructive",
                  )}
                >
                  {c.complianceStatus}
                </span>
              </div>
              <p className="mt-2 text-sm font-medium">{c.headline}</p>
              <p className="mt-1 line-clamp-3 text-xs text-muted-foreground">{c.bodyText}</p>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                {c.loanTermRange} · max APR {c.maxApr || "—"}%
              </p>
            </button>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
