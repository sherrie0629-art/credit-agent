import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { pingGoogleAdsFn } from "@/lib/creditagent/google-ads.functions";

type PingResult = Awaited<ReturnType<typeof pingGoogleAdsFn>>;

export function GoogleAdsConnectionPanel() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PingResult | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await pingGoogleAdsFn();
      setResult(res);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setResult({
        ok: false,
        mode: "off",
        message: "探活请求失败",
        env: {
          mode: "off",
          configured: false,
          missing: [],
          customerId: null,
          loginCustomerId: null,
        },
        error: msg,
      });
      toast.error("Google Ads 探活失败", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const modeLabel = !result
    ? busy
      ? "检查中"
      : "—"
    : result.mode === "test"
      ? result.ok
        ? "Test · 已连接"
        : "Test · 未连通"
      : "Off";

  return (
    <div className="rounded-md border border-border bg-background/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium">Google Ads</p>
          <p className="mt-1 text-xs text-muted-foreground">
            测试账户 API · MODE 默认 off · 密钥仅 server env · 探活只检查连接；结构请到「投放结构」用一键同步导入
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
          {busy ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          探活
        </Button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span
          className={
            result?.ok
              ? "rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-600"
              : "rounded border border-border px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
          }
        >
          {modeLabel}
        </span>
        {result?.env.customerId && (
          <span className="font-mono text-[11px] text-muted-foreground">
            CID {result.env.customerId}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-muted-foreground">
        {result?.message ?? (busy ? "检查连接中…" : "尚未探活")}
      </p>
      {result?.error && (
        <p className="mt-1 font-mono text-[11px] text-destructive">{result.error}</p>
      )}
      {result?.env.missing?.length ? (
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          缺少：{result.env.missing.join(", ")}
        </p>
      ) : null}
      {result?.ok && result.campaigns && result.campaigns.length > 0 && (
        <ul className="mt-2 max-h-28 space-y-1 overflow-auto font-mono text-[11px] text-muted-foreground">
          {result.campaigns.slice(0, 8).map((c) => (
            <li key={c.resourceName}>
              {c.name} · {c.resourceName}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
