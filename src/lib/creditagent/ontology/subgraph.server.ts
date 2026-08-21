// 本体子图查询层：以某个实体为中心取 N 跳邻域。
// 目的：Agent / LLM / 审批 UI 都不需要全量 snapshot，只取相关子图，控制 token 与延迟。
import { OBJECT_TYPES, type ObjectTypeId } from "./objects";
import { incomingLinks, outgoingLinks, type LinkTypeDef } from "./links";

export interface OntologyNode {
  type: ObjectTypeId;
  id: string;
  props: Record<string, unknown>;
}

export interface OntologyEdge {
  link: string;
  fromType: ObjectTypeId;
  fromId: string;
  toType: ObjectTypeId;
  toId: string;
}

export interface Subgraph {
  root: { type: ObjectTypeId; id: string };
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  truncated: boolean;
  depth: number;
}

const MAX_DEPTH = 3;
const DEFAULT_NODE_CAP = 200;
/** 每条边最多展开的邻居数，避免 Lead 这类高基数实体炸掉子图。 */
const FANOUT_CAP = 25;

async function db() {
  const { getReadClient } = await import("../read-client.server");
  return getReadClient();
}

function nodeKey(type: ObjectTypeId, id: string) {
  return `${type}:${id}`;
}

/** 复合主键实体（如 CreativePlacement）用拼接键。 */
function rowId(type: ObjectTypeId, row: Record<string, unknown>): string {
  const def = OBJECT_TYPES[type];
  return def.idColumns.map((c) => String(row[c] ?? "")).join("|");
}

function pickProps(type: ObjectTypeId, row: Record<string, unknown>) {
  const def = OBJECT_TYPES[type];
  const props: Record<string, unknown> = {};
  for (const col of def.keyColumns) {
    if (row[col] !== undefined) props[col] = row[col];
  }
  return props;
}

async function fetchRows(
  type: ObjectTypeId,
  column: string,
  values: string[],
): Promise<Record<string, unknown>[]> {
  if (values.length === 0) return [];
  const def = OBJECT_TYPES[type];
  const supabase = await db();
  const { data, error } = await (supabase as any)
    .from(def.table)
    .select(def.keyColumns.join(","))
    .in(column, values)
    .limit(FANOUT_CAP * Math.max(values.length, 1));
  if (error) return [];
  return (data ?? []) as Record<string, unknown>[];
}

interface Frontier {
  type: ObjectTypeId;
  ids: string[];
}

/**
 * 从 root 出发，按 links.ts 声明的边双向遍历有限跳邻域。
 * 缺表（例如 audience_segments 尚未建）时静默跳过该条边，不影响其余子图。
 */
export async function getSubgraph(input: {
  rootType: ObjectTypeId;
  rootId: string;
  depth?: number;
  nodeCap?: number;
}): Promise<Subgraph> {
  const depth = Math.min(Math.max(input.depth ?? 2, 1), MAX_DEPTH);
  const nodeCap = input.nodeCap ?? DEFAULT_NODE_CAP;

  const nodes = new Map<string, OntologyNode>();
  const edges: OntologyEdge[] = [];
  const edgeSeen = new Set<string>();
  let truncated = false;

  const rootDef = OBJECT_TYPES[input.rootType];
  const rootRows = await fetchRows(input.rootType, rootDef.idColumns[0]!, [input.rootId]);
  if (rootRows.length === 0) {
    return { root: { type: input.rootType, id: input.rootId }, nodes: [], edges: [], truncated: false, depth };
  }
  for (const row of rootRows) {
    nodes.set(nodeKey(input.rootType, rowId(input.rootType, row)), {
      type: input.rootType,
      id: rowId(input.rootType, row),
      props: pickProps(input.rootType, row),
    });
  }

  function addNode(type: ObjectTypeId, row: Record<string, unknown>): string | null {
    const id = rowId(type, row);
    const key = nodeKey(type, id);
    if (nodes.has(key)) return id;
    if (nodes.size >= nodeCap) {
      truncated = true;
      return null;
    }
    nodes.set(key, { type, id, props: pickProps(type, row) });
    return id;
  }

  function addEdge(e: OntologyEdge) {
    const key = `${e.link}:${e.fromId}->${e.toId}`;
    if (edgeSeen.has(key)) return;
    edgeSeen.add(key);
    edges.push(e);
  }

  let frontier: Frontier[] = [{ type: input.rootType, ids: [input.rootId] }];

  for (let hop = 0; hop < depth; hop++) {
    const next = new Map<ObjectTypeId, Set<string>>();

    for (const f of frontier) {
      // 正向：从 f.type 出发的边（子实体）
      for (const l of outgoingLinks(f.type)) {
        await expand(l, f, "forward", next);
      }
      // 反向：指向 f.type 的边（父实体 / 反查）
      for (const l of incomingLinks(f.type)) {
        await expand(l, f, "backward", next);
      }
    }

    frontier = [...next.entries()].map(([type, ids]) => ({ type, ids: [...ids] }));
    if (frontier.length === 0 || nodes.size >= nodeCap) break;
  }

  async function expand(
    l: LinkTypeDef,
    f: Frontier,
    direction: "forward" | "backward",
    next: Map<ObjectTypeId, Set<string>>,
  ) {
    if (nodes.size >= nodeCap) {
      truncated = true;
      return;
    }

    if (l.through) {
      const supabase = await db();
      const srcCol = direction === "forward" ? l.through.fromColumn : l.through.toColumn;
      const dstCol = direction === "forward" ? l.through.toColumn : l.through.fromColumn;
      const { data, error } = await (supabase as any)
        .from(l.through.table)
        .select(`${srcCol},${dstCol}`)
        .in(srcCol, f.ids)
        .limit(FANOUT_CAP * f.ids.length);
      if (error) return;
      const otherType = direction === "forward" ? l.to : l.from;
      const otherIds = [
        ...new Set((data ?? []).map((r: any) => String(r[dstCol])).filter(Boolean)),
      ] as string[];
      const rows = await fetchRows(otherType, OBJECT_TYPES[otherType].idColumns[0]!, otherIds);
      const byId = new Map(rows.map((r) => [String(r[OBJECT_TYPES[otherType].idColumns[0]!]), r]));
      for (const r of data ?? []) {
        const otherId = String((r as any)[dstCol]);
        const otherRow = byId.get(otherId);
        if (!otherRow) continue;
        const added = addNode(otherType, otherRow);
        if (!added) continue;
        addEdge(
          direction === "forward"
            ? { link: l.id, fromType: l.from, fromId: String((r as any)[srcCol]), toType: l.to, toId: added }
            : { link: l.id, fromType: l.from, fromId: added, toType: l.to, toId: String((r as any)[srcCol]) },
        );
        (next.get(otherType) ?? next.set(otherType, new Set()).get(otherType)!).add(added);
      }
      return;
    }

    if (direction === "forward") {
      // from 侧在 frontier：查 to 表中 fk = frontier ids
      const rows = await fetchRows(l.to, l.foreignKeyOnTo, f.ids);
      for (const row of rows) {
        const toId = addNode(l.to, row);
        if (!toId) continue;
        addEdge({
          link: l.id,
          fromType: l.from,
          fromId: String(row[l.foreignKeyOnTo]),
          toType: l.to,
          toId,
        });
        (next.get(l.to) ?? next.set(l.to, new Set()).get(l.to)!).add(toId);
      }
    } else {
      // to 侧在 frontier：先取这些行的 fk 值，再回查 from 表
      const toRows = await fetchRows(l.to, OBJECT_TYPES[l.to].idColumns[0]!, f.ids);
      const fkValues = [
        ...new Set(toRows.map((r) => r[l.foreignKeyOnTo]).filter(Boolean).map(String)),
      ];
      const fromRows = await fetchRows(l.from, l.referencesOnFrom, fkValues);
      const byId = new Map(fromRows.map((r) => [String(r[l.referencesOnFrom]), r]));
      for (const toRow of toRows) {
        const fk = toRow[l.foreignKeyOnTo];
        if (!fk) continue;
        const fromRow = byId.get(String(fk));
        if (!fromRow) continue;
        const fromId = addNode(l.from, fromRow);
        if (!fromId) continue;
        addEdge({
          link: l.id,
          fromType: l.from,
          fromId,
          toType: l.to,
          toId: rowId(l.to, toRow),
        });
        (next.get(l.from) ?? next.set(l.from, new Set()).get(l.from)!).add(fromId);
      }
    }
  }

  return {
    root: { type: input.rootType, id: input.rootId },
    nodes: [...nodes.values()],
    edges,
    truncated,
    depth,
  };
}
