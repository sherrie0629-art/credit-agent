import { Link, useRouterState } from "@tanstack/react-router";
import {
  Activity,
  BarChart3,
  ShieldCheck,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { useAgentBootstrap, useAgentStore } from "@/lib/creditagent/store";
import { cn } from "@/lib/utils";

const NAV: { to: string; label: string; sub: string; icon: LucideIcon }[] = [
  { to: "/", label: "决策指挥中心", sub: "白盒 Agent 实时推理", icon: Activity },
  { to: "/campaigns", label: "预算与投放", sub: "全托管预算调配", icon: SlidersHorizontal },
  { to: "/compliance", label: "合规素材", sub: "合规审计与素材实验室", icon: ShieldCheck },
  { to: "/analytics", label: "全链路归因", sub: "放款转化与 ROAS", icon: BarChart3 },
];


export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useAgentBootstrap();
  const mode = useAgentStore((s) => s.mode);
  const online = useAgentStore((s) => s.agentOnline);

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/90 backdrop-blur lg:flex">
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
          <p className="label-mono">agent runtime</p>
          <p className="mt-1 flex items-center gap-2 font-mono text-xs">
            <span className={cn("size-1.5 rounded-full", online ? "bg-success" : "bg-destructive")} />
            {online ? "AUTONOMOUS RUNNING" : "PAUSED"}
          </p>
          <p className="mt-2 font-mono text-[11px] text-muted-foreground">
            mode = {mode === "FULL_AUTO" ? "full-auto" : "semi-auto"}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">poll = 15min</p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex gap-1 overflow-x-auto border-b border-border bg-sidebar/80 p-2 lg:hidden">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "shrink-0 rounded-md px-3 py-2 font-mono text-xs",
                pathname === item.to
                  ? "bg-sidebar-accent text-neon"
                  : "text-muted-foreground",
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
        <main className="min-w-0 flex-1 p-4 md:p-8">{children}</main>
      </div>
    </div>
  );
}
