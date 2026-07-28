## 目标

产出一份可交付的中文架构设计文档 PDF（存放到 `/mnt/documents/CreditAgent_AI_架构设计文档.pdf`），让新同事一眼看懂：系统有哪些模块、每张表存什么、业务含义是什么、数据从哪来流到哪去。

## 文档结构（约 14-18 页）

1. **封面 + 阅读指引**：系统一句话定位（消费信贷广告投放 Agent）、文档适用对象、版本日期。
2. **系统总览**：六大模块（决策指挥中心、广告系列矩阵、素材中心、全链路归因、离线转化回传、公开接入 API）与它们的职责边界。
3. **技术架构**：前端路由层 → server function（RPC）→ server 层业务逻辑 → 数据库（含 service_role 边界与 RLS 说明）；公开 API 路由（线索捕获、放款回调、回传定时任务）的位置与鉴权方式。
4. **数据实体设计**：逐表说明，每张表一个小节，含字段表（字段名 / 类型 / 业务含义）与「谁写入、谁读取」：
   - 投放侧：`campaigns`、`creative_assets`、`creative_placements`、`creative_metrics`
   - 实验侧：`creative_variants`、`creative_experiments`
   - 事实侧：`leads`、`lead_events`
   - 回传侧：`conversion_uploads`、`conversion_settings`
   - 决策/配置：`agent_decisions`、`agent_settings`
   - 展示派生：`funnel_stages`、`channel_trend`、`channel_breakdown`
   - 视图：`v_campaign_facts`、`v_creative_facts`、`v_funnel`（口径公式写清楚：CPL、CPS、授信通过率如何算）
5. **实体关系图（ER）**：一张全局关系图 + 一张「素材 × 广告系列 × 线索」归因关系放大图，标注外键与权重（`share`）含义。
6. **数据流向图**：
   - 主链路：落地页点击 → `/api/public/leads` → `leads`（按 placement 权重带上 `creative_id`）→ 放款系统 webhook `/api/public/loan-events` → `lead_events` → 视图汇总 → 快照 `getSnapshot()` → 前端各页面。
   - 回传链路：`lead_events` → 入队 `conversion_uploads` → Mock/Live 适配器 → 平台 → 回传健康度 → 反哺决策推理链。
   - 素材迭代链路：`creative_metrics` + 后端事实 → 疲劳打分 → AI 生成变体 → 合规扫描 → A/B 实验 → 胜出上线。
7. **核心业务规则**：单一事实来源原则（所有绩效指标只认 `leads` + `lead_events`）、风控优先自动暂停、Human-in-the-Loop 审批与回滚、合规红线（APR ≤ 36%、贷期 ≥ 61 天、禁用话术）。
8. **维护指引**：新增一张表/一个指标的标准做法、常见坑（写死汇总值与事实表打架）、关键文件索引（`agent.server.ts`、`creative.server.ts`、`conversions.server.ts`、`fatigue.ts`、`compliance.ts`）。

## 实施步骤

1. 读取当前 server 层代码与数据库真实 schema（含视图定义、外键、RLS 策略），保证文档与实现完全一致，不写想象中的字段。
2. 用 ReportLab 生成 PDF，注册 DejaVu / Noto CJK 字体保证中文与图表文字正常渲染；表格用 Platypus Table，配色沿用应用的深色霓虹风格（深底 + 青/柠檬绿点缀），但正文页用浅底保证打印可读。
3. ER 图与数据流向图直接用 ReportLab 绘制矢量框线图（不依赖外部渲染），保证清晰可缩放。
4. 生成后逐页转图片做视觉 QA：检查中文是否出现方块、表格是否越界、图是否重叠，修完再交付。

## 技术备注

文档只做只读产出，不改动应用代码与数据库。字段口径以线上 schema 与视图 SQL 为准，文中每个指标公式都会标出来源表。
