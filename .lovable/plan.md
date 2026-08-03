## 目标

在不改变"规则层拥有最终执行权"这一原则的前提下，给 Planner 增加一层 LLM 分析师：它读全量快照，产出跨广告组的诊断与建议动作，但**永远不直接写投放状态**——所有建议落为 `PENDING_APPROVAL` 决策卡，人工批准后仍要过现有 `preflight` + `checkBudgetChange` 闸门。

这补上当前纯规则层的三个真实缺口：单广告组孤立决策、无法处理矛盾信号（CTR 涨但通过率跌）、阈值拍脑袋无解释。

## 边界（硬约束）

| 项 | 约束 |
|---|---|
| 输出动作集 | 只能是枚举：`BUDGET_SHIFT` / `CREATIVE_PAUSE` / `CREATIVE_REFRESH` / `NO_ACTION` |
| 预算建议幅度 | 只能给 −40% ~ +30% 区间内的整数百分比，超出由代码截断 |
| 落库状态 | 一律 `PENDING_APPROVAL`，`agentType: "Planner"`，来源标注 `LLM` |
| 工具权限 | 无 tool-calling、无 DB 写权限、无网络。一次纯文本输入 → 结构化输出 |
| 幻觉净化 | 引用的 `adGroupId` 必须存在于快照，否则整条丢弃；数值字段全部 `Number()` + clamp |
| 冲突处理 | 同一广告组若规则层已有 PENDING 决策，LLM 建议标记"与规则建议冲突"，两张卡并列，不合并 |

## 实施步骤

**1. 纯函数层 `src/lib/creditagent/advisor.ts`**
- `sanitizeAdvice(raw, snapshot)`：校验 id 存在、动作在枚举内、百分比 clamp 到 [−40, +30]、条数截断为 ≤5、每条必须带非空 `rationale` 与引用指标。零依赖，可单测。

**2. 服务端 `src/lib/creditagent/advisor.server.ts`**
- `buildAdvisorContext()`：从 `getSnapshot()` 压缩出紧凑事实包（各广告组 spend / leads / CPL / CPS / 通过率 / 疲劳分 / 状态 + 漏斗与渠道趋势），只传数字，不传自由文本。
- `runPlannerAdvisor()`：走 Lovable AI Gateway，模型 `openai/gpt-5.6-sol`（Responses API，流式调用、服务端消费最终文本）。system prompt 明确"你是分析师不是执行者，只能输出上述枚举动作"。结构化输出用 `Output.object`，schema 保持精简（限制写在 prompt 里，由代码强制）；`NoObjectGeneratedError` 时降级解析原始文本，再失败则本轮无建议并记一条失败 run。
- `advisor.functions.ts` 做 `createServerFn` RPC 包装（`advisor.server.ts` 只在 handler 内动态引入）。

**3. 落库（迁移）**
- 新增表 `advisor_runs`：run 时间、触发来源、原始输出、净化后条数、耗时、token 数、失败原因。含 GRANT + RLS。
- 净化后的每条建议写入 `agent_decisions`：`status = PENDING_APPROVAL`，`reasoning_chain` = 模型推理要点 + 一行"本条由 LLM 分析师提出，未经执行"，`guardrailNote` 预填该动作若执行会命中哪条硬规则（对 `checkBudgetChange` 做 dry-run）。
- `AgentDecision.triggerSource` 扩展为 `"EVENT" | "SWEEP" | "LLM"`。

**4. 审批路径复用现有闸门**
- `approveDecision()` 中，对 `triggerSource === "LLM"` 的决策，批准时**必须**重跑 `preflight` + `checkBudgetChange`；DENY 则批准失败并回写拒绝原因。人工点同意也绕不过规则层。

**5. 触发时机**
- 手动：Command Center 加"运行 AI 分析师"按钮。
- 定时：接入现有 `/api/public/cron/agent-sweep`，但降频——规则扫描 15 分钟一次，LLM 分析师每 6 小时一次（控噪音与成本），用 `advisor_runs` 做幂等。

**6. UI**
- 决策卡加来源徽标：`规则` / `LLM 建议`（后者异色，明确"未经验证的假设"）。
- LLM 卡片额外展示：引用的指标快照、若执行将命中的硬规则预判、"与规则层建议冲突"提示。
- 素材中心不变；分析师只覆盖 Planner 域。

## 技术细节

- 模型调用集中在 `advisor.server.ts`，`.server.ts` 命名保证不进客户端包。
- `sanitizeAdvice` 配 vitest 用例：越界百分比、不存在的 adGroupId、非法动作名、空 rationale、超量条数五种脏输入。
- 成本：每 6 小时一次、单次输入约 2-4k token，日成本可忽略。
