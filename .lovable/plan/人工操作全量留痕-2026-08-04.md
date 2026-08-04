# 人工操作全量留痕

## 现状（已核实）

确定性校验与硬熔断已经在位：`guardrails.ts` 是纯函数规则层，`preflight()` 在所有自动写入路径前置执行，`agent_settings.kill_switch` 开启后 `checkKillSwitch` 对 `automated=true` 一律 DENY 并写 `guardrail_events`。

但审计留痕只覆盖了一部分：

- 已留痕：`setKillSwitch`（写 `SET_KILL_SWITCH`）、`setAdGroupBudget`（写 `SET_AD_GROUP_BUDGET`，含 from/to）、自动路径的 preflight 拦截。
- 未留痕：`setAdGroupStatus`（人工暂停/启用广告组——正是"关广告"这一步）、`setMode`（半自动/全自动切换）、`setRiskFirst`、`approveDecision` / `rejectDecision` / `rollbackDecision` 的人工裁决动作本身。

也就是说：人工关掉一个广告组、或者把系统切到全自动，事后在 `guardrail_events` 里查不到任何记录。

## 目标

任何会改变投放状态或改变 Agent 自治级别的人工操作，都在 `guardrail_events` 留下一条可审计记录，包含动作、目标、前后值、结论。不改变现有的放行/拦截行为——只补审计，不新增拦截。

## 改动清单

### 1. `setAdGroupStatus`（`agent.server.ts`）

先读当前广告组拿到原状态，再写库，然后 `recordGuardrail`：

- `action: "SET_AD_GROUP_STATUS"`、`targetId: id`
- `requested: { from: 原状态, to: 新状态, adGroupName, campaignName }`
- `decision`：`verdict: "ALLOW"`、`rule: "MANUAL_OVERRIDE"`、`detail` 写明"人工将广告组「X」从 ACTIVE 改为 PAUSED"

人工暂停时同步调用 `releaseToPool`（`reason: "MANUAL"`），让人工关广告释放的预算也进池，与自动暂停口径一致；启用时不动池。

### 2. `setMode` / `setRiskFirst`

各补一条 `recordGuardrail`，`rule` 分别为 `MANUAL_MODE_CHANGE`、`MANUAL_RISK_FIRST`，`requested` 记录前后值。切到 `FULL_AUTO` 的 `detail` 明确写"自治级别提升"，便于事后追责。

### 3. 决策裁决三件套

`approveDecision` / `rejectDecision` / `rollbackDecision` 各补一条，`action` 为 `APPROVE_DECISION` / `REJECT_DECISION` / `ROLLBACK_DECISION`，`targetId` 为决策 id，`requested` 带上 `actionType`、`adGroupId`、原 `status`。`approveDecision` 内部已有的 preflight 与 `checkBudgetChange` 记录保留不变，这条是"谁批的"这一层。

### 4. 统一封装

在 `guardrails.server.ts` 增加一个 `recordManualAction({ action, targetId, rule, detail, requested })` 薄封装，内部复用 `recordGuardrail`，固定 `verdict: "ALLOW"`，避免每处手写 decision 对象。

## 技术细节

- 不新增表：`guardrail_events` 已有 `action` / `target_id` / `rule` / `verdict` / `detail` / `requested` 字段，够用，无迁移。
- 所有留痕在写库成功之后执行，写库失败不产生误导性审计记录。
- 留痕失败不阻断主流程（try/catch 吞掉并计入返回值），避免审计写入把人工止血操作卡死。
- 不改任何判定阈值，不改 `preflight` 的放行逻辑。
