## 现状（已核实）

- `autoPauseRiskyGroups` 暂停低通过率广告组时，只在推理链里写一句"预算暂存至 Planner 待分配池"，**没有任何资金池实体**，被释放的预算凭空消失。
- `applyAiSuggestion` 削减预算时推理链写"转移至高胜率广告组"，但实际只对当前广告组做了一次 `daily_budget` 更新，**没有对手方**。
- 因此：跨广告组再分配能力目前是文案，不是功能。

## 目标

把"释放 → 入池 → 分配 → 落库"做成一条闭环，分配逻辑全部硬编码（不交给 LLM），每一笔转移都有来源、去向、依据与审批状态。

## 数据模型（迁移）

新增 `budget_pool_entries`（资金池流水，单一事实来源）：
- `direction`：`RELEASE`（释放入池）/ `ALLOCATE`（出池分配）
- `ad_group_id`、`campaign_id`、`amount`
- `reason`：`RISK_PAUSE` / `LOW_WIN_RATE` / `PACING` / `SCALE_UP` / `MANUAL`
- `decision_id`：关联 `agent_decisions`，做归因
- `status`：`PENDING` / `APPLIED` / `REVERTED`
- 含 GRANT（service_role）+ RLS

池余额 = `sum(RELEASE) - sum(ALLOCATE)`，按天口径（`占用日` 字段），不单独存字段避免对不上账。

## 分配算法（纯函数 `src/lib/creditagent/reallocate.ts`，可单测）

输入：池余额、候选广告组事实（通过率、CPS、日预算、消耗节奏、状态）。

1. **候选筛选**：`status = ACTIVE` 且 `last20ApprovalRate ≥ 22%` 且 `CPS ≤ 目标 CPS × 1.1` 且今日消耗率 ≥ 60%（有承接能力才给钱）。
2. **打分**：`score = 通过率权重 × (approvalRate / 阈值) + 成本权重 × (targetCPS / cps)`，权重硬编码并写进推理链。
3. **按分数比例分配**，逐个再过 `checkBudgetChange`：单次幅度、单日累计幅度、绝对上限，超限 CLAMP，剩余额度回流池。
4. **无合格候选**：全额留池，生成一条"资金滞留"提示决策，不强行乱花。

零依赖、零网络，覆盖用例：无候选、单候选超上限、多候选比例分配、余额为 0、CLAMP 后剩余回流。

## 服务端 `reallocate.server.ts`

- `releaseToPool({ adGroupId, amount, reason, decisionId })`：暂停/降预算路径调用，写 RELEASE 流水。
- `runReallocation(triggerSource)`：读池余额 + 快照 → 跑纯函数 → 生成一张 **组合决策卡**（`actionType = BUDGET_SHIFT`，`agentType = Planner`），推理链逐行列出"从 A 释放 $X（原因）→ 分配给 B $Y（得分/依据）"。
  - `FULL_AUTO` 且 `preflight` 全绿：直接落库 ad_groups + ALLOCATE 流水，状态 `EXECUTED`。
  - 否则：`PENDING_APPROVAL`，流水 `PENDING`，批准后统一 apply。
- 回滚：`rollback_to` 存原始预算映射，撤销时按流水逆向写回。

## 接入点

- `autoPauseRiskyGroups`：暂停成功后调用 `releaseToPool`，把该组全额日预算入池，推理链改为真实金额而非空话。
- `applyAiSuggestion` 削减分支：削减差额入池。
- `approveDecision`：识别再分配类决策，批准时重跑 `preflight` + 逐笔 `checkBudgetChange` 后才写 ad_groups。
- `sweep.server.ts`：在实验结算之后、LLM 分析师之前插入 `runReallocation("SWEEP")`，保证释放与分配同一轮完成。

## UI

- 预算矩阵页顶部加"待分配资金池"卡片：余额、来源明细、最近一次分配时间，一个"立即再分配"手动按钮。
- 决策卡支持多行转移展示（来源组 → 目标组 → 金额 → 依据得分）。
- 广告组行加"本次获得 +$X（来自 XXX）"归因标签。

## 技术细节

- 分配判定全部硬编码，LLM 不参与；LLM 分析师若提出 `BUDGET_SHIFT`，仍走原有待审批路径，不直接动池。
- 所有金额取整到美元，避免浮点尾差导致池余额对不上。
- 池按自然日重置：跨日未分配的余额生成一条"过期回收"流水，防止陈旧资金被拿来扩量。
