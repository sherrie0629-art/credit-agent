// 本体护栏审计的只读查询：给 /ontology 页面展示最近被结构性不变量拦下的动作。
export interface OntologyGuardrailEvent {
  id: number;
  action: string;
  targetId: string;
  rule: string;
  verdict: string;
  detail: string;
  createdAt: string;
}

export async function listOntologyGuardrailEvents(limit = 20): Promise<OntologyGuardrailEvent[]> {
  const { getReadClient } = await import("../read-client.server");
  const supabase = await getReadClient();
  const { data, error } = await (supabase as any)
    .from("guardrail_events")
    .select("id,action,target_id,rule,verdict,detail,created_at")
    .like("action", "ONTOLOGY:%")
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error || !data) return [];
  return (data as Record<string, any>[]).map((r) => ({
    id: Number(r["id"]),
    action: String(r["action"] ?? ""),
    targetId: String(r["target_id"] ?? ""),
    rule: String(r["rule"] ?? ""),
    verdict: String(r["verdict"] ?? ""),
    detail: String(r["detail"] ?? ""),
    createdAt: String(r["created_at"] ?? ""),
  }));
}
