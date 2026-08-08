import { useEffect } from "react";
import { Link, useRouter, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  FlaskConical,
  Radio,
  RefreshCw,
  SlidersHorizontal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";

import { refreshAgentState, useAgentBootstrap, useAgentStore } from "@/lib/creditagent/store";
import { cn } from "@/lib/utils";

const NAV: {
  to: "/" | "/campaigns" | "/creative" | "/analytics" | "/conversions";
  label: string;
  sub: string;
  icon: LucideIcon;
  search?: Record<string, string>;
}[] = [
  { to: "/", label: "决策指挥中心", sub: "白盒 Agent 实时推理", icon: Activity },
  {
    to: "/campaigns",
    label: "预算与投放",
    sub: "结构管理 · 全托管预算",
    icon: SlidersHorizontal,
    search: { tab: "budget" },
  },
  {
    to: "/creative",
    label: "素材中心",
    sub: "合规审计 · 疲劳迭代 · A/B",
    icon: FlaskConical,
    search: { tab: "library" },
  },
  {
    to: "/analytics",
    label: "全链路归因",
    sub: "复盘 · 高管周报",
    icon: BarChart3,
    search: { tab: "ops", week: "this" },
  },
  { to: "/conversions", label: "离线转化回传", sub: "Google OCI · Meta CAPI", icon: Radio },
];





export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useAgentBootstrap();
  const router = useRouter();
  const mode = useAgentStore((s) => s.mode);
  const online = useAgentStore((s) => s.agentOnline);
  const error = useAgentStore((s) => s.error);
  const loading = useAgentStore((s) => s.loading);
  const loaded = useAgentStore((s) => s.loaded);

  // 空闲时预热所有菜单页的代码块（图表页尤其重），点击时无需现下载。
  useEffect(() => {
    const idle =
      (window as unknown as { requestIdleCallback?: (cb: () => void) => number })
        .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 1_200));
    const id = idle(() => {
      for (const item of NAV) {
        if (item.to === pathname) continue;
        void router
          .preloadRoute(
            item.search
              ? ({ to: item.to, search: item.search } as never)
              : ({ to: item.to } as never),
          )
          .catch(() => undefined);
      }
    });
    return () => {
      const cancel = (window as unknown as { cancelIdleCallback?: (h: number) => void })
        .cancelIdleCallback;
      if (cancel) cancel(id as number);
      else window.clearTimeout(id as number);
    };
    // 只需在首次挂载时预热一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);




  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/90 backdrop-blur print:hidden lg:flex">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-5 py-5">
          <div className="relative flex size-9 items-center justify-center rounded-md border border-neon/40 bg-neon/10">
            <span className="font-mono text-sm font-bold neon-text">CA</span>
            <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-success pulse-dot" />
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">CreditAgent AI</p>
            <p className="label-mono">v1.0 mvp</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const active = pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                search={item.search as never}
                className={cn(
                  "group flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-neon"
                    : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                )}
              >
                <item.icon
                  className={cn("mt-0.5 size-4", active ? "text-neon" : "text-muted-foreground")}
                />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium">{item.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {item.sub}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="m-3 rounded-md border border-sidebar-border bg-background/60 p-3">
          <p className="label-mono">agent 运行状态</p>
          <p className="mt-1 flex items-center gap-2 text-xs">
            <span className={cn("size-1.5 rounded-full", online ? "bg-success" : "bg-destructive")} />
            {online ? "自动托管运行中" : "已暂停"}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            托管模式：{mode === "FULL_AUTO" ? "全自动" : "半自动"}
          </p>
          <p className="text-[11px] text-muted-foreground">采集间隔：15 分钟</p>
        </div>

      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-sidebar/80 p-2 print:hidden lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              search={item.search as never}
              className={cn(
                "shrink-0 rounded-md px-3 py-2 text-xs",
                pathname === item.to
                  ? "bg-sidebar-accent text-neon"
                  : "text-muted-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
        {error && (
          <div className="print:hidden flex flex-wrap items-center gap-3 border-b border-destructive/40 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
            <TriangleAlert className="size-4 shrink-0" />
            <span>
              后端数据加载失败：{error}（已自动重试 3 次）。
              {loaded
                ? "当前显示的是上一次成功获取的数据，可能已过期。"
                : "当前页面显示的是空数据，不代表数据库无记录。"}
            </span>
            <button
              type="button"
              disabled={loading}
              onClick={() => void refreshAgentState()}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-destructive/50 px-2.5 py-1 font-mono text-[11px] transition-colors hover:bg-destructive/20 disabled:opacity-50"
            >
              <RefreshCw className={cn("size-3", loading && "animate-spin")} />
              {loading ? "重试中" : "重试"}
            </button>
          </div>
        )}
        <main className="min-w-0 flex-1 p-4 md:p-8 print:p-0">{children}</main>

      </div>
    </div>
  );
}
