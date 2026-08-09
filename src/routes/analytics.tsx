import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { AppShell } from "@/components/creditagent/AppShell";
import { ExecWeeklyReport } from "@/components/creditagent/analytics/ExecWeeklyReport";
import { OpsAnalyticsTab } from "@/components/creditagent/analytics/OpsAnalyticsTab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  agentSnapshotQuery,
  prefetchQueryNonBlocking,
} from "@/lib/creditagent/store";
import type { WeekKey } from "@/lib/creditagent/report";

const TABS = ["ops", "exec"] as const;
type TabKey = (typeof TABS)[number];
const WEEKS = ["this", "last"] as const;

export const Route = createFileRoute("/analytics")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: TABS.includes(search.tab as TabKey) ? (search.tab as TabKey) : ("ops" as TabKey),
    week: WEEKS.includes(search.week as WeekKey) ? (search.week as WeekKey) : ("this" as WeekKey),
  }),
  head: () => ({
    meta: [
      { title: "全链路放款归因分析 | CreditAgent AI" },
      {
        name: "description",
        content:
          "Impressions → Clicks → Leads → 授信通过 → 实际放款 全漏斗归因，对比前端 CPL ROI 与真实 30 天 LTV/ROAS；支持高管周报打印导出。",
      },
      { property: "og:title", content: "全链路放款归因分析 | CreditAgent AI" },
      {
        property: "og:description",
        content: "通过 Meta CAPI 与 Google 离线转化回传打通授信与放款数据。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => prefetchQueryNonBlocking(context.queryClient, agentSnapshotQuery),
  component: AnalyticsPage,
});

function AnalyticsPage() {
  const { tab, week } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  function setTab(next: string) {
    navigate({ search: { tab: next as TabKey, week } });
  }

  function setWeek(next: WeekKey) {
    navigate({ search: { tab, week: next } });
  }

  return (
    <AppShell>
      <header className="panel p-5 print:hidden">
        <p className="label-mono">module 04</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">全链路放款归因</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          复盘工作台 · 高管周报（可打印 PDF）· Meta CAPI + Google 线下转化回传
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList className="print:hidden">
          <TabsTrigger value="ops">复盘工作台</TabsTrigger>
          <TabsTrigger value="exec">高管周报</TabsTrigger>
        </TabsList>

        <TabsContent value="ops" className="mt-4 print:hidden">
          <OpsAnalyticsTab week={week} onWeekChange={setWeek} />
        </TabsContent>
        <TabsContent value="exec" className="mt-4">
          <ExecWeeklyReport week={week} onWeekChange={setWeek} />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
