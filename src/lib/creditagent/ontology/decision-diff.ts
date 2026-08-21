// 决策的「图谱差分」：本次动作会改动哪些实体的哪些字段。
// 纯类型 + 纯函数，服务端生成、客户端渲染共用。
import type { ObjectTypeId } from "./objects";
import { OBJECT_TYPES } from "./objects";

export type DiffValue = string | number | boolean | null;

export interface OntologyChange {
  type: ObjectTypeId;
  id: string;
  /** 实体展示名，避免 UI 再去查一次。 */
  name?: string;
  field: string;
  /** 字段中文名，便于直接展示。 */
  fieldLabel?: string;
  from: DiffValue;
  to: DiffValue;
}

/** 决策落库时保存的裁剪版子图快照。 */
export interface OntologySnapshot {
  root: { type: ObjectTypeId; id: string };
  nodes: { type: ObjectTypeId; id: string; props: Record<string, DiffValue> }[];
  edges: { link: string; fromType: ObjectTypeId; fromId: string; toType: ObjectTypeId; toId: string }[];
  truncated: boolean;
  capturedAt: string;
}

const FIELD_LABEL: Record<string, string> = {
  status: "状态",
  daily_budget: "日预算",
  bid_target: "出价目标",
  share: "投放占比",
  spent_today: "今日消耗",
};

export function fieldLabel(field: string) {
  return FIELD_LABEL[field] ?? field;
}

export function objectLabel(type: ObjectTypeId) {
  return OBJECT_TYPES[type]?.label ?? type;
}

export function change(c: OntologyChange): OntologyChange {
  return { ...c, fieldLabel: c.fieldLabel ?? fieldLabel(c.field) };
}

/** 供 UI 直接渲染的一行文案，例如「广告组 A · 日预算 1200 → 1500」。 */
export function describeChange(c: OntologyChange): string {
  const who = `${objectLabel(c.type)}「${c.name ?? c.id}」`;
  return `${who} · ${c.fieldLabel ?? fieldLabel(c.field)} ${fmt(c.from)} → ${fmt(c.to)}`;
}

function fmt(v: DiffValue) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "boolean") return v ? "是" : "否";
  return String(v);
}
