import { useEffect, useState } from "react";
import { FlaskConical, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { pingMetaAdsFn } from "@/lib/creditagent/meta-ads.functions";
import { agentApi } from "@/lib/creditagent/store";

type PingResult = Awaited<ReturnType<typeof pingMetaAdsFn>>;

export function MetaAdsConnectionPanel() {
  const [busy, setBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [result, setResult] = useState<PingResult | null>(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await pingMetaAdsFn();
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
          adAccountId: null,
          graphVersion: "v21.0",
        },
        error: msg,
      });
      toast.error("Meta Ads 探活失败", { description: msg });
    } finally {
      setBusy(false);
    }
  };

  const seedWriteCards = async () => {
    setSeedBusy(true);
    try {
      const res = await agentApi.seedMetaAdsWriteTestDecisions();
      if (!res.ok) {
        toast.error(res.message, { description: res.warning });
        return;
      }
      const lines = [
        res.targetAdGroupName ? `目标 Ad Set：${res.targetAdGroupName}` : null,
        ...res.cards.map((c) => c.label),
        ...(res.skipped.length ? [`跳过：${res.skipped.join("；")}`] : []),
      ].filter(Boolean);
      toast.success(res.message, {
        description: [res.warning, lines.join(" · ")].filter(Boolean).join("\n"),
        duration: 8_000,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error("生成验收卡片失败", { description: msg });
    } finally {
      setSeedBusy(false);
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium">Meta Ads</p>
          <p className="mt-1 text-xs text-muted-foreground">
            测试账户 Marketing API · MODE 默认 off · 密钥仅 server env · 探活只检查连接；结构请到「投放结构」一键同步
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>
            {busy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            探活
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={seedBusy}
            onClick={() => void seedWriteCards()}
          >
            {seedBusy ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
            )}
            生成写入验收卡片
          </Button>
        </div>
      </div>
      <p className="mt-3 font-mono text-[11px]">
        状态：<span className={result?.ok ? "text-success" : "text-muted-foreground"}>{modeLabel}</span>
        {result?.env.adAccountId ? ` · ${result.env.adAccountId}` : ""}
      </p>
      {result?.message && (
        <p className="mt-1 text-[11px] text-muted-foreground">{result.message}</p>
      )}
      {result?.error && <p className="mt-1 text-[11px] text-destructive">{result.error}</p>}
      {result?.env.missing?.length ? (
        <p className="mt-1 text-[11px] text-warning">缺少：{result.env.missing.join(", ")}</p>
      ) : null}
    </div>
  );
}
