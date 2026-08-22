// 无框架用例：信封失败、幻觉 ID、BUDGET_SHIFT params 过契约。
import { parseAdvisorEnvelope, screenAdvisorSuggestions } from "../src/lib/creditagent/ontology/action-schema.ts";
import { validateActionParams } from "../src/lib/creditagent/ontology/invariants.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`ok  ${msg}`);
  }
}

const envelopeFail = parseAdvisorEnvelope({ summary: "x" });
assert(!envelopeFail.ok, "信封缺 suggestions 应失败");

const screenedBad = screenAdvisorSuggestions({ not: "an envelope" }, new Set(["AdGroup:ag_1"]));
assert(!screenedBad.ok && Boolean(screenedBad.error), "非法信封 screen 失败并带 error");

const hallucinated = screenAdvisorSuggestions(
  {
    summary: "诊断",
    suggestions: [
      {
        actionType: "BUDGET_SHIFT",
        params: { toAdGroupId: "ghost", amount: 100, nextDailyBudget: 2000 },
        rationale: "把预算给一个不存在的组",
        metric: "CostPerDisbursement",
        currentValue: 22,
        thresholdValue: 19,
        confidence: 0.8,
      },
    ],
  },
  new Set(["AdGroup:ag_1"]),
);
assert(hallucinated.ok, "信封形状合法");
assert(hallucinated.kept.length === 0, "幻觉 ID 不应进入 kept");
assert(
  hallucinated.dropped.some((d) => d.reason.includes("疑似幻觉")),
  "幻觉 ID 应记入 dropped",
);

const schemaOk = validateActionParams("BUDGET_SHIFT", {
  toAdGroupId: "ag_1",
  amount: 400,
  nextDailyBudget: 2200,
});
assert(schemaOk.ok, "合法 BUDGET_SHIFT params 通过 Zod");

const schemaBad = validateActionParams("BUDGET_SHIFT", { toAdGroupId: "ag_1", amount: -1 });
assert(!schemaBad.ok, "负 amount 被 Zod 拒绝");

const known = new Set(["AdGroup:ag_1", "AdGroup:ag_2"]);
const happy = screenAdvisorSuggestions(
  {
    summary: "PMax 可放量",
    suggestions: [
      {
        actionType: "BUDGET_SHIFT",
        params: { fromAdGroupId: "ag_2", toAdGroupId: "ag_1", amount: 400, nextDailyBudget: 2200 },
        rationale: "PMax CPS 低于目标，从 Search 回收 400",
        metric: "CostPerDisbursement",
        currentValue: 14.2,
        thresholdValue: 19,
        confidence: 0.86,
      },
    ],
  },
  known,
);
assert(happy.ok && happy.kept.length === 1, "合法建议进入 kept");
assert(happy.kept[0]?.targetId === "ag_1", "targetId 取 toAdGroupId");

if (process.exitCode) {
  console.error("advisor-contract-smoke failed");
  process.exit(1);
}
console.log("advisor-contract-smoke passed");
