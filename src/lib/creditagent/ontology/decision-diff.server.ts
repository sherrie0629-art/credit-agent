// 生成决策落库用的「动作前子图快照 + 预期变更」。
import type { ObjectTypeId } from "./objects";
import type { OntologyChange, OntologySnapshot } from "./decision-diff";
import { change } from "./decision-diff";

/**
 * 取一份裁剪版子图（默认 1 跳、40 个节点）作为决策前快照。
 * 任何异常都降级为 null —— 影响面展示是增强信息，绝不能阻塞决策落库。
 */
export async function captureOntologyBefore(input: {
  rootType: ObjectTypeId;
  rootId: string;
  depth?: number;
  nodeCap?: number;
}): Promise<OntologySnapshot | null> {
  try {
    const { getSubgraph } = await import("./subgraph.server");
    const sg = await getSubgraph({
      rootType: input.rootType,
      rootId: input.rootId,
      depth: input.depth ?? 1,
      nodeCap: input.nodeCap ?? 40,
    });
    if (sg.nodes.length === 0) return null;
    return {
      root: sg.root,
      nodes: sg.nodes as OntologySnapshot["nodes"],
      edges: sg.edges,
      truncated: sg.truncated,
      capturedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** 组装可直接落库的两列。 */
export async function buildDecisionOntology(input: {
  rootType: ObjectTypeId;
  rootId: string;
  changes: OntologyChange[];
  depth?: number;
}): Promise<{ ontology_before: OntologySnapshot | null; ontology_diff: OntologyChange[] }> {
  const before = await captureOntologyBefore(input);
  return { ontology_before: before, ontology_diff: input.changes.map(change) };
}
