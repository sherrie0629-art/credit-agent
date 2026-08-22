// 阶段七：把 LLM 参谋的上下文从「全量快照摘要」换成「问题相关子图」。
// 好处有三：token 明显下降、模型看到的是带关系的业务图谱、可引用的实体 ID 天然收敛成白名单。
import type { AgentSnapshot } from "./types";
import { getSubgraph, type Subgraph } from "./ontology/subgraph.server";
import { serializeSubgraph } from "./ontology/serialize";
import { TARGET_CPS } from "./reallocate";

/** 单轮最多取几个广告组的子图；再多没有边际信息，只增加 token。 */
const MAX_FOCUS_GROUPS = 5;
const SUBGRAPH_DEPTH = 2;
const SUBGRAPH_NODE_CAP = 50;
const MAX_EXTRA_CREATIVES = 3;
const MAX_EXTRA_EXPERIMENTS = 3;

export interface AdvisorContext {
  /** 喂给模型的文本上下文 */
  text: string;
  /** 允许被引用的广告组 ID（幻觉过滤白名单） */
  focusIds: string[];
  /** 子图内所有实体的 `Type:id`，用于引用完整性校验 */
  knownRefs: Set<string>;
  nodeCount: number;
}

/**
 * 选出「值得诊断」的广告组：偏离目标 CPS 越远、花得越多，优先级越高。
 * 完全没有花费的组不进入上下文（无信息量）。
 */
export function pickFocusGroups(snapshot: AgentSnapshot): AgentSnapshot["adGroups"] {
  return [...snapshot.adGroups]
    .filter((g) => g.spentToday > 0 || g.clicks > 0)
    .map((g) => ({
      g,
      score: Math.abs((g.cps || TARGET_CPS) - TARGET_CPS) * Math.max(g.spentToday, 1),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FOCUS_GROUPS)
    .map((x) => x.g);
}

export function snapshotKnownRefs(snapshot: AgentSnapshot): Set<string> {
  const refs = new Set<string>();
  for (const g of snapshot.adGroups) refs.add(`AdGroup:${g.id}`);
  for (const c of snapshot.creatives) refs.add(`CreativeAsset:${c.id}`);
  for (const e of snapshot.experiments) refs.add(`CreativeExperiment:${e.id}`);
  for (const v of snapshot.variants) refs.add(`CreativeVariant:${v.id}`);
  for (const p of snapshot.placements) {
    refs.add(`CreativePlacement:${p.creativeId}|${p.adGroupId}`);
    refs.add(`CreativeAsset:${p.creativeId}`);
    refs.add(`AdGroup:${p.adGroupId}`);
  }
  return refs;
}

function accountHeader(snapshot: AgentSnapshot) {
  const l = snapshot.guardrailLimits;
  return [
    "# 账户约束",
    `目标 CPS=${TARGET_CPS} · 模式=${snapshot.mode} · 风险姿态=${snapshot.riskPosture} · 熔断=${snapshot.killSwitch ? "开" : "关"}`,
    `单次预算变动上限 ${l?.maxBudgetDeltaPct ?? "-"}% · 单组日预算上限 ${l?.maxAdGroupDailyBudget ?? "-"} · 每小时动作上限 ${l?.maxActionsPerHour ?? "-"}`,
  ].join("\n");
}

async function trySubgraph(
  rootType: "AdGroup" | "CreativeAsset" | "CreativeExperiment",
  rootId: string,
): Promise<Subgraph | null> {
  try {
    const sg = await getSubgraph({
      rootType,
      rootId,
      depth: SUBGRAPH_DEPTH,
      nodeCap: SUBGRAPH_NODE_CAP,
    });
    return sg.nodes.length > 0 ? sg : null;
  } catch {
    return null;
  }
}

/** 拉取聚焦广告组的 2 跳子图，并补疲劳素材 / 进行中实验根，避免 3 跳外的 ID 不可见。 */
export async function buildSubgraphContext(snapshot: AgentSnapshot): Promise<AdvisorContext> {
  const focus = pickFocusGroups(snapshot);
  const subgraphs: Subgraph[] = [];
  const seenRoots = new Set<string>();

  const push = (sg: Subgraph | null) => {
    if (!sg) return;
    const key = `${sg.root.type}:${sg.root.id}`;
    if (seenRoots.has(key)) return;
    seenRoots.add(key);
    subgraphs.push(sg);
  };

  for (const g of focus) {
    push(await trySubgraph("AdGroup", g.id));
  }

  const tired = snapshot.creatives
    .filter((c) => c.fatigueLevel && c.fatigueLevel !== "HEALTHY")
    .slice(0, MAX_EXTRA_CREATIVES);
  for (const c of tired) {
    push(await trySubgraph("CreativeAsset", c.id));
  }

  const running = snapshot.experiments.filter((e) => e.status === "RUNNING").slice(0, MAX_EXTRA_EXPERIMENTS);
  for (const e of running) {
    push(await trySubgraph("CreativeExperiment", e.id));
  }

  const knownRefs = new Set<string>();
  for (const sg of subgraphs) {
    for (const n of sg.nodes) knownRefs.add(`${n.type}:${n.id}`);
  }

  const sections = subgraphs.map((sg) => serializeSubgraph(sg));
  const text = [accountHeader(snapshot), ...sections].join("\n\n---\n\n");

  return {
    text,
    focusIds: focus.map((g) => g.id),
    knownRefs,
    nodeCount: knownRefs.size,
  };
}
