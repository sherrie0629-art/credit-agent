import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Search, Braces } from "lucide-react";
import {
  fetchSubgraphFn,
  fetchSubgraphTextFn,
} from "@/lib/creditagent/ontology/ontology.functions";
import { OBJECT_TYPES, OBJECT_TYPE_IDS, type ObjectTypeId } from "@/lib/creditagent/ontology/objects";
import { LINK_TYPES, type LinkTypeId } from "@/lib/creditagent/ontology/links";
import { useAgentStore } from "@/lib/creditagent/store";
import { cn } from "@/lib/utils";

export function InstanceTab() {
  const adGroups = useAgentStore((s) => s.adGroups);
  const creatives = useAgentStore((s) => s.creatives);

  const [rootType, setRootType] = useState<ObjectTypeId>("AdGroup");
  const [rootId, setRootId] = useState("");
  const [depth, setDepth] = useState(2);
  const [llmView, setLlmView] = useState(false);
  const [submitted, setSubmitted] = useState<{ rootType: ObjectTypeId; rootId: string; depth: number } | null>(
    null,
  );

  const fetchSubgraph = useServerFn(fetchSubgraphFn);
  const fetchText = useServerFn(fetchSubgraphTextFn);

  const graphQuery = useQuery({
    queryKey: ["ontology-subgraph", submitted?.rootType, submitted?.rootId, submitted?.depth],
    enabled: !!submitted && !llmView,
    queryFn: () => fetchSubgraph({ data: submitted! }),
  });

  const textQuery = useQuery({
    queryKey: ["ontology-subgraph-text", submitted?.rootType, submitted?.rootId, submitted?.depth],
    enabled: !!submitted && llmView,
    queryFn: () => fetchText({ data: submitted! }),
  });

  function run(type: ObjectTypeId = rootType, id: string = rootId, d: number = depth) {
    if (!id.trim()) return;
    setRootType(type);
    setRootId(id);
    setSubmitted({ rootType: type, rootId: id.trim(), depth: d });
  }

  const sg = graphQuery.data;
  const nodesByType = new Map<string, NonNullable<typeof sg>["nodes"]>();
  for (const n of sg?.nodes ?? []) {
    const arr = nodesByType.get(n.type) ?? [];
    arr.push(n);
    nodesByType.set(n.type, arr);
  }

  return (
    <div className="space-y-4">
      <section className="panel space-y-3 p-4">
        <p className="label-mono">subgraph query</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={rootType}
            onChange={(e) => setRootType(e.target.value as ObjectTypeId)}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
          >
            {OBJECT_TYPE_IDS.map((id) => (
              <option key={id} value={id}>
                {OBJECT_TYPES[id].label}（{id}）
              </option>
            ))}
          </select>
          <input
            value={rootId}
            onChange={(e) => setRootId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="实体 ID"
            className="min-w-[240px] flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs"
          />
          <select
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs"
          >
            {[1, 2, 3].map((d) => (
              <option key={d} value={d}>
                深度 {d}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => run()}
            className="inline-flex items-center gap-1.5 rounded-md border border-neon/40 bg-neon/10 px-3 py-1.5 text-xs text-neon transition-colors hover:bg-neon/20"
          >
            <Search className="size-3.5" /> 取子图
          </button>
          <button
            type="button"
            onClick={() => setLlmView((v) => !v)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs transition-colors",
              llmView ? "border-neon/40 bg-neon/10 text-neon" : "border-border text-muted-foreground",
            )}
          >
            <Braces className="size-3.5" /> LLM 视角
          </button>
        </div>

        <div className="space-y-1.5">
          <p className="label-mono">快捷入口</p>
          <div className="flex flex-wrap gap-1.5">
            {adGroups.slice(0, 6).map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => run("AdGroup", g.id, depth)}
                className="rounded border border-border px-2 py-0.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon"
              >
                广告组 · {g.name}
              </button>
            ))}
            {creatives.slice(0, 4).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => run("CreativeAsset", c.id, depth)}
                className="rounded border border-border px-2 py-0.5 text-[11px] transition-colors hover:border-neon/50 hover:text-neon"
              >
                素材 · {c.headline.slice(0, 16)}
              </button>
            ))}
            {adGroups.length === 0 && creatives.length === 0 && (
              <span className="text-[11px] text-muted-foreground">快照尚未加载，稍后再试或直接粘贴 ID。</span>
            )}
          </div>
        </div>
      </section>

      {!submitted && (
        <p className="panel p-4 text-sm text-muted-foreground">
          选一个实体取其邻域子图。这正是 AI 参谋做判断时看到的全部上下文——不多不少。
        </p>
      )}

      {(graphQuery.isFetching || textQuery.isFetching) && (
        <p className="panel flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> 正在遍历业务图谱…
        </p>
      )}

      {llmView && textQuery.data && (
        <section className="panel p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="label-mono">llm context</p>
            <span className="font-mono text-[11px] text-muted-foreground">
              {textQuery.data.nodes} 节点 · {textQuery.data.edges} 关系 · 约{" "}
              {Math.ceil(textQuery.data.text.length / 3)} tokens
            </span>
          </div>
          <pre className="mt-2 max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed">
            {textQuery.data.text}
          </pre>
        </section>
      )}

      {!llmView && sg && (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">实体 × {sg.nodes.length}</h2>
              {sg.truncated && (
                <span className="rounded border border-warning/40 bg-warning/12 px-1.5 py-0.5 text-[10px] text-warning">
                  已截断
                </span>
              )}
            </div>
            {[...nodesByType.entries()].map(([type, list]) => (
              <article key={type} className="panel p-3">
                <p className="label-mono">
                  {OBJECT_TYPES[type as ObjectTypeId].label} × {list.length}
                </p>
                <ul className="mt-2 space-y-2">
                  {list.map((n) => (
                    <li key={`${n.type}:${n.id}`} className="rounded-md border border-border p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] text-neon">{n.id}</span>
                        {(n.type !== sg.root.type || n.id !== sg.root.id) && (
                          <button
                            type="button"
                            onClick={() => run(n.type, n.id, depth)}
                            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-neon/50 hover:text-neon"
                          >
                            以此为根
                          </button>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px] text-muted-foreground">
                        {Object.entries(n.props)
                          .filter(([k]) => !OBJECT_TYPES[n.type].idColumns.includes(k))
                          .map(([k, v]) => (
                            <span key={k}>
                              {k}=<span className="text-foreground">{String(v ?? "-")}</span>
                            </span>
                          ))}
                      </div>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>

          <section className="panel p-3">
            <p className="label-mono">关系 × {sg.edges.length}</p>
            <ul className="mt-2 space-y-1">
              {sg.edges.map((e, i) => (
                <li key={i} className="font-mono text-[10px] text-muted-foreground">
                  <span className="text-foreground">{OBJECT_TYPES[e.fromType].label}</span>:{e.fromId} —
                  {LINK_TYPES[e.link as LinkTypeId]?.label ?? e.link}→{" "}
                  <span className="text-foreground">{OBJECT_TYPES[e.toType].label}</span>:{e.toId}
                </li>
              ))}
              {sg.edges.length === 0 && <li className="text-xs text-muted-foreground">该实体暂无邻居。</li>}
            </ul>
          </section>
        </div>
      )}

      {(graphQuery.error || textQuery.error) && (
        <p className="panel p-4 text-sm text-destructive">子图查询失败，请确认实体 ID 是否存在。</p>
      )}
    </div>
  );
}
