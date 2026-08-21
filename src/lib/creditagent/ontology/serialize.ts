// 把子图压成紧凑文本，供 LLM 上下文使用（比整包 JSON 省一半以上 token）。
import type { Subgraph } from "./subgraph.server";
import { OBJECT_TYPES } from "./objects";
import { LINK_TYPES, type LinkTypeId } from "./links";

function fmtValue(v: unknown): string {
  if (v === null || v === undefined) return "-";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "boolean") return v ? "是" : "否";
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

export function serializeSubgraph(sg: Subgraph): string {
  const lines: string[] = [];
  lines.push(`# 业务子图（根：${OBJECT_TYPES[sg.root.type].label} ${sg.root.id}，深度 ${sg.depth}）`);
  if (sg.truncated) lines.push("注意：子图已截断，仅含最相关的一部分节点。");

  lines.push("\n## 实体");
  const byType = new Map<string, typeof sg.nodes>();
  for (const n of sg.nodes) {
    const arr = byType.get(n.type) ?? [];
    arr.push(n);
    byType.set(n.type, arr);
  }
  for (const [type, list] of byType) {
    const def = OBJECT_TYPES[type as keyof typeof OBJECT_TYPES];
    lines.push(`### ${def.label} (${type}) × ${list.length}${def.platformMirrored ? " · 平台镜像只读" : ""}`);
    for (const n of list) {
      const kv = Object.entries(n.props)
        .filter(([k]) => !def.idColumns.includes(k))
        .map(([k, v]) => `${k}=${fmtValue(v)}`)
        .join(" ");
      lines.push(`- ${n.id} | ${kv}`);
    }
  }

  lines.push("\n## 关系");
  for (const e of sg.edges) {
    const l = LINK_TYPES[e.link as LinkTypeId];
    lines.push(`- ${e.fromType}:${e.fromId} --${l?.label ?? e.link}--> ${e.toType}:${e.toId}`);
  }

  return lines.join("\n");
}
