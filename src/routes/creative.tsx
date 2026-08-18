import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { agentSnapshotQuery, prefetchQueryNonBlocking } from "@/lib/creditagent/store";
import { AppShell } from "@/components/creditagent/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreativeLibraryTab } from "@/components/creditagent/creative/CreativeLibraryTab";
import { ComplianceTab } from "@/components/creditagent/creative/ComplianceTab";
import { ExperimentsTab } from "@/components/creditagent/creative/ExperimentsTab";
import type { ComplianceInput } from "@/lib/creditagent/compliance";

const TABS = ["library", "compliance", "experiments"] as const;
type TabKey = (typeof TABS)[number];

export const Route = createFileRoute("/creative")({
  validateSearch: (search: Record<string, unknown>): { tab: TabKey; creativeId?: string } => ({
    tab: TABS.includes(search.tab as TabKey) ? (search.tab as TabKey) : ("library" as TabKey),
    ...(typeof search.creativeId === "string" && search.creativeId
      ? { creativeId: search.creativeId }
      : {}),
  }),
  head: () => ({
    meta: [
      { title: "素材中心 · 疲劳预警与合规审计 | CreditAgent AI" },
      {
        name: "description",
        content:
          "素材全生命周期一站式管理：疲劳雷达打分、AI 变体生成、金融合规审计与 A/B 赛马自动淘汰低效素材。",
      },
      { property: "og:title", content: "素材中心 · 疲劳预警与合规审计" },
      {
        property: "og:description",
        content: "素材库、合规审计与 A/B 实验看板合并为一个白盒可追溯的模块。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  loader: ({ context }) => prefetchQueryNonBlocking(context.queryClient, agentSnapshotQuery),
  component: CreativeHub,
});

function CreativeHub() {
  const { tab, creativeId } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  const [draft, setDraft] = useState<ComplianceInput>({
    headline: "100% Approval — No Credit Check!",
    bodyText:
      "Instant approval without income proof. Get money in your account today, guaranteed.",
    loanTermRange: "—",
    maxApr: 0,
    specialAdCategory: false,
  });

  function setTab(next: string) {
    navigate({ search: { tab: next as TabKey } });
  }

  return (
    <AppShell>
      <header className="panel p-5">
        <p className="label-mono">module 03</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">素材中心</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          素材库 → 疲劳预警 → AI 变体生成 → 合规审计 → A/B 实验，全生命周期闭环托管。
        </p>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <TabsList>
          <TabsTrigger value="library">素材库与疲劳雷达</TabsTrigger>
          <TabsTrigger value="compliance">合规审计</TabsTrigger>
          <TabsTrigger value="experiments">A/B 实验看板</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="mt-4">
          <CreativeLibraryTab
            onReview={(d) => {
              setDraft(d);
              setTab("compliance");
            }}
          />
        </TabsContent>

        <TabsContent value="compliance" className="mt-4">
          <ComplianceTab draft={draft} setDraft={setDraft} />
        </TabsContent>

        <TabsContent value="experiments" className="mt-4">
          <ExperimentsTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
