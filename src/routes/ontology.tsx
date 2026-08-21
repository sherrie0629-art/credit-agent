import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/creditagent/AppShell";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SchemaTab } from "@/components/creditagent/ontology/SchemaTab";
import { InstanceTab } from "@/components/creditagent/ontology/InstanceTab";
import { ActionsTab } from "@/components/creditagent/ontology/ActionsTab";

const TABS = ["schema", "instance", "actions"] as const;
type TabKey = (typeof TABS)[number];

export const Route = createFileRoute("/ontology")({
  validateSearch: (search: Record<string, unknown>): { tab: TabKey } => ({
    tab: TABS.includes(search.tab as TabKey) ? (search.tab as TabKey) : ("schema" as TabKey),
  }),
  head: () => ({
    meta: [
      { title: "业务本体 · 实体图谱与动作护栏 | CreditAgent AI" },
      {
        name: "description",
        content:
          "白盒查看 CreditAgent 的业务本体：12 类实体、14 条关系、6 类动作与结构性不变量，并可实时试算某个动作是否会被护栏拦下。",
      },
      { property: "og:title", content: "业务本体 · 实体图谱与动作护栏" },
      {
        property: "og:description",
        content: "实体图谱、实例子图下钻与动作前置校验，一屏说明 Agent 为什么不会乱写。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: OntologyBrowser,
});

function OntologyBrowser() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <AppShell>
      <header className="panel p-5">
        <p className="label-mono">module 06</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">业务本体浏览器</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          系统认识哪些业务对象、它们如何相连、Agent 能做什么以及被什么挡住——全部可点开验证。
        </p>
      </header>

      <Tabs
        value={tab}
        onValueChange={(next) => navigate({ search: { tab: next as TabKey } })}
        className="mt-4"
      >
        <TabsList>
          <TabsTrigger value="schema">本体图谱</TabsTrigger>
          <TabsTrigger value="instance">实体浏览</TabsTrigger>
          <TabsTrigger value="actions">动作与护栏</TabsTrigger>
        </TabsList>

        <TabsContent value="schema" className="mt-4">
          <SchemaTab />
        </TabsContent>
        <TabsContent value="instance" className="mt-4">
          <InstanceTab />
        </TabsContent>
        <TabsContent value="actions" className="mt-4">
          <ActionsTab />
        </TabsContent>
      </Tabs>
    </AppShell>
  );
}
