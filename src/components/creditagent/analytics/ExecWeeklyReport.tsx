import { useEffect, useState } from "react";
import { Copy, Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { fetchExecReportFn } from "@/lib/creditagent/report.functions";
import { TARGET_CPS, type WeekKey } from "@/lib/creditagent/report";
import type { ExecReport } from "@/lib/creditagent/report";
import { cn } from "@/lib/utils";

/** Cursor / VS Code Simple Browser 跑在 Electron 上；window.print() 会打崩宿主（已知 Electron 缺陷）。 */
function isElectronHost() {
  if (typeof navigator === "undefined") return false;
  return /Electron/i.test(navigator.userAgent);
}

async function printExecReport() {
  if (isElectronHost()) {
    try {
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* ignore */
    }
    toast.message("Cursor 内无法直接打印", {
      description:
        "内置预览调用系统打印会导致 Cursor 退出。链接已复制，请用 Chrome / Safari 打开本页后再点「打印 / 导出 PDF」。",
      duration: 8000,
    });
    return;
  }

  window.print();
}

export function ExecWeeklyReport({
  week,
  onWeekChange,
}: {
  week: WeekKey;
  onWeekChange: (w: WeekKey) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ExecReport | null>(null);
  const [includeAppendix, setIncludeAppendix] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchExecReportFn({ data: { week, includeAppendix } })
      .then((res) => {
        if (!cancelled) setReport(res);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [week, includeAppendix]);

  return (
    <div className="space-y-4">
      <div className="print:hidden flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="label-mono">周期</span>
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(
              [
                ["this", "本周"],
                ["last", "上周"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => onWeekChange(key)}
                className={cn(
                  "rounded px-3 py-1 text-xs transition-colors",
                  week === key ? "bg-neon/15 text-neon" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="ml-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={includeAppendix}
              onChange={(e) => setIncludeAppendix(e.target.checked)}
              className="rounded border-border"
            />
            含附录
          </label>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(window.location.href);
                toast.success("已复制周报链接");
              } catch {
                toast.error("复制失败，请手动复制地址栏");
              }
            }}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" />
            复制链接
          </Button>
          <Button size="sm" onClick={() => void printExecReport()}>
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            打印 / 导出 PDF
          </Button>
        </div>
      </div>

      {error && (
        <p className="print:hidden rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          周报加载失败：{error}
        </p>
      )}

      {report && (
        <article
          id="exec-weekly-report"
          className="mx-auto max-w-3xl space-y-6 rounded-md border border-border bg-background p-6 print:max-w-none print:border-0 print:bg-white print:p-0 print:text-black"
        >
          <header className="border-b border-border pb-4 print:border-neutral-300">
            <p className="label-mono print:text-neutral-500">CreditAgent AI · 投放经营周报</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">高管周报</h2>
            <p className="mt-1 font-mono text-xs text-muted-foreground print:text-neutral-600">
              周期 {report.window.label}
            </p>
            <p className="font-mono text-[11px] text-muted-foreground print:text-neutral-500">
              生成于 {new Date(report.generatedAt).toLocaleString()}
            </p>
          </header>

          <section>
            <h3 className="text-sm font-semibold">结论</h3>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground print:text-neutral-700">
              {report.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ol>
          </section>

          <section>
            <h3 className="text-sm font-semibold">核心数字</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
              {report.kpis.map((k) => (
                <div
                  key={k.key}
                  className="rounded-md border border-border p-3 print:border-neutral-300"
                >
                  <p className="label-mono print:text-neutral-500">{k.label}</p>
                  <p
                    className={cn(
                      "mt-1 font-mono text-lg",
                      k.tone === "bad" && "text-destructive print:text-black",
                      k.tone === "ok" && "text-success print:text-black",
                      (!k.tone || k.tone === "neutral" || k.tone === "warn") && "neon-text print:text-black",
                    )}
                  >
                    {k.value}
                  </p>
                  {k.hint && (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground print:text-neutral-600">
                      {k.hint}
                    </p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground print:text-neutral-500">
              {report.spendNote}
            </p>
          </section>

          <section>
            <h3 className="text-sm font-semibold">渠道对比</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full caption-bottom text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground print:border-neutral-300">
                    <th className="py-2 pr-3 font-mono font-medium">渠道</th>
                    <th className="py-2 pr-3 font-mono font-medium">花费快照</th>
                    <th className="py-2 pr-3 font-mono font-medium">线索</th>
                    <th className="py-2 pr-3 font-mono font-medium">放款</th>
                    <th className="py-2 pr-3 font-mono font-medium">CPS</th>
                    <th className="py-2 pr-3 font-mono font-medium">通过率</th>
                    <th className="py-2 font-mono font-medium">回传成功率</th>
                  </tr>
                </thead>
                <tbody>
                  {report.channels.map((c) => (
                    <tr
                      key={c.channel}
                      className="border-b border-border/60 print:border-neutral-200"
                    >
                      <td className="py-2 pr-3 font-medium">{c.channel}</td>
                      <td className="py-2 pr-3 font-mono">
                        ${Math.round(c.spend).toLocaleString()}
                      </td>
                      <td className="py-2 pr-3 font-mono">{c.leads.toLocaleString()}</td>
                      <td className="py-2 pr-3 font-mono">
                        {c.disbursedCount.toLocaleString()} / $
                        {Math.round(c.disbursedAmount).toLocaleString()}
                      </td>
                      <td
                        className={cn(
                          "py-2 pr-3 font-mono",
                          c.disbursedCount > 0 && c.cps > TARGET_CPS
                            ? "text-destructive print:text-black"
                            : "",
                        )}
                      >
                        {c.disbursedCount > 0 ? `$${c.cps.toFixed(2)}` : "—"}
                      </td>
                      <td className="py-2 pr-3 font-mono">
                        {(c.approvalRate * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 font-mono">
                        {(c.feedbackSuccessRate * 100).toFixed(1)}%
                        <span className="ml-1 text-muted-foreground print:text-neutral-500">
                          (缺口 {(c.feedbackGapRate * 100).toFixed(0)}%)
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {includeAppendix && report.appendix.includeAppendix && (
            <section className="border-t border-border pt-4 print:border-neutral-300">
              <h3 className="text-sm font-semibold">附录</h3>
              <p className="mt-1 text-xs text-muted-foreground print:text-neutral-600">
                本期 Agent 决策记录 {report.appendix.decisionCount} 条 · 广告组按 CPS（有放款/花费的组）
              </p>
              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <AppendixList title="CPS 较优（Top）" rows={report.appendix.topByCps} />
                <AppendixList title="CPS 偏高（Bottom）" rows={report.appendix.bottomByCps} />
              </div>
            </section>
          )}

          <footer className="border-t border-border pt-3 text-[11px] text-muted-foreground print:border-neutral-300 print:text-neutral-500">
            本报告由规则引擎生成，不含大模型自由文本。目标 CPS ${TARGET_CPS.toFixed(2)}。打印时请选择「另存为
            PDF」。
          </footer>
        </article>
      )}
    </div>
  );
}

function AppendixList({
  title,
  rows,
}: {
  title: string;
  rows: { id: string; name: string; channel: string; cps: number; spend: number; disbursedCount: number }[];
}) {
  return (
    <div>
      <p className="label-mono">{title}</p>
      <ul className="mt-2 space-y-1.5">
        {rows.length === 0 && (
          <li className="text-xs text-muted-foreground">暂无足够样本</li>
        )}
        {rows.map((r) => (
          <li
            key={r.id}
            className="flex items-baseline justify-between gap-2 text-xs"
          >
            <span className="min-w-0 truncate">
              <span className="text-muted-foreground">{r.channel}</span> {r.name}
            </span>
            <span className="shrink-0 font-mono">
              ${r.cps.toFixed(2)} · {r.disbursedCount}放款
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
