import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { captureLeadFn } from "@/lib/creditagent/conversions.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/lp")({
  head: () => ({
    meta: [
      { title: "极速信用贷申请 | CreditAgent AI 演示落地页" },
      {
        name: "description",
        content:
          "演示落地页：自动采集 Google gclid / gbraid 与 Meta fbclid / fbp / fbc 点击标识，作为离线转化回传的匹配依据。",
      },
      { property: "og:title", content: "极速信用贷申请 | CreditAgent AI" },
      { property: "og:description", content: "点击标识采集演示落地页。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LandingPage,
});

function readCookie(name: string) {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : undefined;
}

function LandingPage() {
  const [clickIds, setClickIds] = useState<Record<string, string | undefined>>({});
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [leadId, setLeadId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    setClickIds({
      gclid: q.get("gclid") ?? undefined,
      gbraid: q.get("gbraid") ?? undefined,
      wbraid: q.get("wbraid") ?? undefined,
      fbclid: q.get("fbclid") ?? undefined,
      fbp: readCookie("_fbp"),
      fbc: readCookie("_fbc") ?? (q.get("fbclid") ? `fb.1.${Date.now()}.${q.get("fbclid")}` : undefined),
    });
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await captureLeadFn({
        data: {
          ...clickIds,
          email: email || undefined,
          phone: phone || undefined,
          landingUrl: window.location.href,
        },
      });
      setLeadId(res.leadId);
    } finally {
      setBusy(false);
    }
  }

  const captured = Object.entries(clickIds).filter(([, v]) => v);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-6">
      <header className="panel p-6">
        <p className="label-mono">demo landing page</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">最快 3 分钟完成信用评估</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          期限 61 天起，最高 APR 35.9%。本页仅用于演示点击标识（gclid / fbclid）采集与线索入库。
        </p>
      </header>

      <section className="panel p-6">
        <h2 className="text-sm font-semibold">已捕获的点击标识</h2>
        {captured.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            当前 URL 无点击参数。可试试 <code className="font-mono">/lp?gclid=Cj0KCQdemo123</code>
          </p>
        ) : (
          <ul className="mt-2 space-y-1 font-mono text-[11px] text-muted-foreground">
            {captured.map(([k, v]) => (
              <li key={k}>
                <span className="text-neon">{k}</span> = {v}
              </li>
            ))}
          </ul>
        )}

        <form className="mt-5 space-y-3" onSubmit={submit}>
          <Input
            type="email"
            placeholder="邮箱（将做 SHA-256 哈希后入库）"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            placeholder="手机号（将做 SHA-256 哈希后入库）"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "提交中…" : "提交申请"}
          </Button>
        </form>

        {leadId ? (
          <p className="mt-4 rounded-md border border-success/40 bg-success/10 p-3 text-xs">
            线索已入库：<span className="font-mono">{leadId}</span>
            ，后续授信 / 放款事件将自动进入回传队列。
          </p>
        ) : null}
      </section>
    </main>
  );
}
