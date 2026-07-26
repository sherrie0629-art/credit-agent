## 目标

新增第 5 个模块「创意疲劳预警与自动迭代」（`/creative-lab`）：Agent 自动巡检素材疲劳 → AI 真实生成新文案与配图变体 → 合规扫描 → 半自动上线 → A/B 赛马看板自动淘汰败者、扶正胜者。

## 一、产品设计

### 1. 疲劳判定（Creative Agent 自动巡检）
每条素材维护近 7 天投放指标（曝光、点击、CTR、CPL、频次 Frequency、CPS）。疲劳分 0-100，四个信号加权：

```text
CTR 衰减    权重 35   近3日 CTR / 首3日 CTR < 0.7
频次过载    权重 25   Frequency ≥ 3.5
CPL 抬升    权重 25   近3日 CPL / 首3日 CPL > 1.25
素材寿命    权重 15   连续投放 ≥ 14 天
```

分级：`HEALTHY < 40 ≤ WATCH < 70 ≤ FATIGUED`。判定过程写成中文推理链，与现有白盒决策卡片同构。

巡检触发：进入页面自动执行一次；页面提供「立即巡检」按钮；巡检结果写入 `agent_decisions`（`agent_type = Creative`，`action_type = CREATIVE_REFRESH`）。

### 2. 自动迭代（AI 真实生成）
对 `FATIGUED` 素材，Creative Agent 一次生成 3 个变体：
- **文案**：Lovable AI 文本模型，基于原素材 + 疲劳原因 + 金融合规约束（≥61 天期限、APR ≤36%、禁词表）生成标题/正文/角度说明（结构化输出）。
- **配图**：Lovable AI 图像模型流式生成（渐进预览 + 模糊过渡），提示词由文案角度自动派生。
- 生成后立即跑现有 `scanCompliance`；命中严重违规自动调用 `autoFixCompliance` 重写再评分，仍不过则该变体标记「合规阻断」不可上线。

### 3. 半自动执行（沿用 Human-in-the-Loop）
- `SEMI_AUTO`：变体上线生成 `PENDING_APPROVAL` 决策卡，进首页审批队列；批准后进入实验。
- `FULL_AUTO`：直接上线并暂停疲劳原素材，仅记决策日志。

### 4. A/B 赛马 + 自动淘汰
每次上线创建一个实验：对照组（原素材）+ 变体组，按预算均分分流。看板展示每臂的曝光/CTR/CPL/CPS/放款数与置信度。

淘汰规则（Execution Agent）：
```text
样本量 ≥ 1000 曝光 且 置信度 ≥ 95%
  → 胜者 promote：承接全部预算，状态 WINNER
  → 败者 pause：状态 ELIMINATED，写回滚快照
样本不足        → RUNNING，显示「样本积累中」
```
淘汰同样产出决策卡，可在首页回滚。

## 二、数据库改动

新增三张表（含 GRANT + RLS，公开只读演示数据）：

- `creative_metrics`：`creative_id`、`day`、`impressions`、`clicks`、`ctr`、`cpl`、`cps`、`frequency`、`spend`
- `creative_variants`：`id`、`parent_creative_id`、`experiment_id`、`headline`、`body_text`、`image_url`、`angle`、`compliance_status`、`compliance_score`、`status`（DRAFT / PENDING / RUNNING / WINNER / ELIMINATED）、`created_at`
- `creative_experiments`：`id`、`parent_creative_id`、`status`（RUNNING / DECIDED）、`started_at`、`decided_at`、`winner_variant_id`、`arm_stats` jsonb

`creative_assets` 增列：`fatigue_score`、`fatigue_level`、`launched_at`、`last_scanned_at`。
迁移内含种子数据：为现有 3 条素材写 14 天指标曲线，其中 1 条明显疲劳、1 条 WATCH、1 条健康，保证首屏就能看到预警。

## 三、代码改动

**新增**
- `src/lib/creditagent/fatigue.ts` — 疲劳评分与推理链（纯函数，前后端共用）
- `src/lib/creditagent/creative.server.ts` — 巡检、变体落库、实验创建、赛马结算
- `src/lib/creditagent/creative.functions.ts` — `scanFatigueFn` / `generateVariantsFn` / `launchExperimentFn` / `settleExperimentFn`（薄 RPC 包装）
- `src/routes/api/generate-creative-image.ts` — 图像流式 SSE 服务端路由（`createServerFn` 不能流式）
- `src/lib/streamImage.ts` — SSE 解析器（`eventsource-parser` + `flushSync`）
- `src/routes/creative-lab.tsx` — 页面：疲劳雷达卡片列 / 变体生成工作台 / 实验赛马看板
- `src/components/creditagent/FatigueCard.tsx`、`VariantCard.tsx`、`ExperimentBoard.tsx`

**修改**
- `agent.server.ts` / `types.ts` — `AgentSnapshot` 增 `creativeMetrics`、`variants`、`experiments`；`ActionType` 增 `CREATIVE_REFRESH`、`VARIANT_PROMOTE`
- `store.ts` — 新增对应 `agentApi` 方法
- `AppShell.tsx` — 侧栏加「创意迭代」入口（module 05）
- `badges.tsx` — 疲劳等级与变体状态徽标

## 四、技术说明

- 文案生成走 `createServerFn` + AI SDK 结构化输出；图像生成必须走 `src/routes/api/` 服务端路由并透传 SSE，客户端按 partial 帧带模糊渲染。
- 使用 Lovable AI（无需用户提供密钥），文本用 Gemini Flash 系，图像用 Nano Banana 2。
- 生成的图片以 base64 data URL 直接展示并存入 `image_url`（演示态；如需长期存储可后续接入存储桶）。
- 429 / 402 网关错误在 UI 明确提示（额度用尽 / 限流），不静默失败。
- 界面文案中文，保留 Meta / Google / Agent / CTR / CPL / CPS / APR / A/B 等术语。
