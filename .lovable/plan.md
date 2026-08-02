## 现在的做法（已在代码里的部分）

**1. LLM 只用于"生成"，不用于"决策"**
系统里唯一调用大模型的地方是素材变体的文案/图像生成（`creative.server.ts` 的 `generateCopy` / 图片接口）。所有会花钱、动预算的动作——疲劳判定、风控暂停、预算迁移、实验胜出——都是硬编码数值规则：

- 疲劳：CTR 衰减 / 频次 / CPL 抬升合成 0-100 分，阈值 70 触发（`fatigue.ts`）
- 风控优先：末 20 条线索通过率低于阈值 → 暂停（`agent.server.ts`，threshold 0.1 / 19）
- 实验裁决：先过最小样本门槛，再取 CPS 最低臂，附带置信度（`decideExperiment`）

模型没有任何调用工具、改预算、改出价的权限，幻觉最多污染一段文案，动不了钱。

**2. 模型输出的三道确定性净化**
`response_format: json_object` → 解析失败时正则兜底 → 字段全部 `String()` 强制转型、变体数截断为 3 → 送进硬编码的 `scanCompliance`（禁词表、≥61 天期限、APR ≤36%、Meta 特殊广告类别、Disclaimer）→ 命中 CRITICAL 时先 `autoFixCompliance` 重写再复扫 → 仍不过则落库为 `BLOCKED`。

**3. Human-in-the-Loop**
`SEMI_AUTO` 模式下所有决策写入 `PENDING_APPROVAL`，需人工批准；每条决策都带 reasoning_chain + 触发指标/阈值 + rollback 快照。

**4. 触发机制现状：只有一轨半**
事件驱动（用户操作 / 线索与放款事件 webhook）是有的；定时轮询目前只覆盖离线转化回传（`/api/public/cron/upload-conversions`，15 分钟）。**疲劳扫描和风控扫描没有定时轨**，必须有人点才跑——这是你说的"异常穿透"的真实缺口。

---

## 建议补齐的三件事

### A. 独立的风控规则层（API 执行前最后一关）
新增 `src/lib/creditagent/guardrails.server.ts`，纯函数、零 LLM、零网络。所有会改变投放状态的写操作（预算调整、状态切换、变体上线、批准决策）统一先过 `assertAllowed(action)`：

| 规则 | 默认值 | 违反后 |
|---|---|---|
| 单次预算变动幅度 | ≤ ±30% | 拒绝并降级为待审批 |
| 单日累计预算变动 | ≤ ±50% | 拒绝 |
| 单广告组日预算绝对上限 | 可配置 | 截断到上限 |
| 变体上线前实时复扫合规 | 必须 PASSED/WARNING | 拒绝（防止 BLOCKED 变体被误上线） |
| 全局熔断开关 | agent_online=false | 拒绝一切自动写入 |
| 每小时自动动作条数 | ≤ N | 超出转人工 |

被拒绝的动作同样写一条 `status=PENDING_APPROVAL` 的决策记录，附拒绝原因，保证可解释、不静默丢弃。

### B. 定时轮询轨（兜底止损）
新增 `/api/public/cron/agent-sweep`（建议 15 分钟一次），顺序执行：疲劳扫描 → 风控通过率扫描 → 实验裁决 → 预算异常检查（消耗速度超日预算 X% 提前熔断）。与现有事件驱动构成双轨，事件漏了由轮询补。用 `sweep_runs` 表记录每次执行结果，同时用它做幂等，避免重复决策。

### C. 熔断与可观测
- `agent_settings` 增加 `kill_switch`、`max_daily_budget_delta_pct`、`max_actions_per_hour` 三个字段，前端在"决策模式"旁给一个显眼的全局熔断按钮。
- 决策卡片上标注该决策"由事件触发 / 由定时轮询触发"，以及是否被风控层拦截过。

### 技术细节
- guardrails 为纯 TS，不依赖 DB 之外的任何外部服务，便于单测；对应加一组 vitest 用例覆盖每条规则的边界。
- cron 路由放在 `/api/public/*`，用共享密钥 header 校验调用方后再执行。
- 变体上线前的复扫复用现有 `scanCompliance`，不引入第二套规则，避免两套判定漂移。
