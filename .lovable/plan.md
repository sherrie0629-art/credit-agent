## 目标

用模拟数据实现完整的「离线转化回传」闭环（模块 06）：把后端真实的授信/放款结果，带金额价值回传给 Google Ads 与 Meta。所有平台调用走一个**可切换的模拟适配器**，交互、状态机、错误码、看板全部真实可用；将来拿到广告账户，只需把适配器换成真实 HTTP 调用，其余代码不动。

## 现状（已核对）

现有 10 张表没有线索级数据：无 leads 表、无 gclid/fbclid 点击 ID、无回传记录。因此闭环需要从线索层建起。

## 架构

```text
落地页 /lp  ──gclid, gbraid, wbraid, fbclid, fbp, fbc──▶  leads
                                                            │
模拟信贷系统（页面按钮 / 定时器）──▶  lead_events（授信 / 放款 / 首逾）
                                                            │
                                                  conversion_uploads 队列
                                                      │              │
                                          GoogleAdsAdapter    MetaCapiAdapter
                                            (MOCK ⇄ LIVE)      (MOCK ⇄ LIVE)
                                                      │              │
                                            回传健康度看板 + Agent 白盒决策
```

## 实施步骤

### 1. 数据层（migration）
- `leads`：channel、campaign_id、gclid / gbraid / wbraid / fbclid / fbp / fbc、hashed_email / hashed_phone（SHA-256，明文不入库）、landing_url、click_at
- `lead_events`：lead_id、event_type（`LEAD` / `CREDIT_APPROVED` / `LOAN_DISBURSED` / `FIRST_PAYMENT_DEFAULT`）、value、currency、occurred_at、external_ref
- `conversion_uploads`：event_id、platform（google / meta）、status（PENDING / SENT / FAILED / SKIPPED）、attempts、request_payload、response_body、error_code、sent_at；`(event_id, platform)` 唯一，保证幂等
- `conversion_settings`：每渠道 conversion action / dataset id、价值映射规则、回传开关、回溯窗口、`mode`（MOCK / LIVE）
- 种子数据：约 300 条 leads + 对应事件与回传记录，覆盖成功 / 匹配失败 / 超窗 / 重试成功等状态，让看板一进去就有真实曲线

### 2. 点击 ID 捕获
- 新增演示落地页 `/lp`：抓取 URL 点击参数与 `_fbp`/`_fbc` cookie，提交表单 → 服务端 `captureLead` 写入 leads
- 同时提供 `/api/public/leads` 供外部页面 POST（真实上线时直接可用）

### 3. 事件产生（模拟）
- 「模拟信贷系统」面板：一键生成一批线索、推进授信 / 放款 / 首逾事件，可调通过率与放款额分布
- `/api/public/loan-events` webhook 同步实现（HMAC 校验 + Zod + 幂等），现在用模拟数据打，将来接真实风控系统零改造

### 4. 回传引擎（核心，可切换）
- `ConversionAdapter` 接口：`upload(batch) → { accepted, rejected, errorCode?, matchRate }`
- `MockGoogleAdsAdapter`：按 Google OCI 的真实请求体构造 `ClickConversion`（gclid + conversion_value + conversion_date_time），模拟约 85% 匹配率、随机抛 `UNPARSEABLE_GCLID` / `CLICK_NOT_FOUND` / `EXPIRED_CLICK` / 配额限流
- `MockMetaCapiAdapter`：构造 CAPI `/{dataset_id}/events` 载荷（`action_source: system_generated`、fbc/fbp、哈希 em/ph、value），返回 `events_received` 与 `fbtrace_id`，模拟低匹配与 400 错误
- 统一队列处理：批量取 PENDING → 分发 → 指数退避重试（≤5 次）→ 写回响应与错误码；超回溯窗口（Google 90 天 / Meta 7 天）标记 SKIPPED
- `pg_cron` 每 15 分钟触发 `/api/public/cron/upload-conversions`，界面也有「立即回传」按钮
- 真实载荷全部落库到 `request_payload`，界面可展开查看——这就是将来对接真实 API 的验收依据

### 5. 转化回传看板（新模块 06，导航第 5 项）
- 顶部指标：今日回传成功率、匹配率、平均回传延迟、被拒事件数
- 队列表格：事件类型、渠道、状态、错误码、重试次数、手动重试、查看请求/响应 JSON
- 归因对比图：平台侧回传后转化数 vs 数据库真实放款数，暴露漏斗缺口
- 配置面板：conversion action / dataset 绑定、价值映射规则、回传开关、**MOCK / LIVE 切换开关**（LIVE 在无凭证时显示「待接入广告账户」）
- Agent 联动：成功率跌破阈值、匹配率异常、连续 `UNPARSEABLE_GCLID` 等，自动写入 `agent_decisions` 白盒决策进审批队列

### 6. 与现有模块打通
- `/analytics` 增加「回传后真实 ROAS」对照，与现有前端 ROI 曲线并列

## 技术说明

- 全部逻辑在 TanStack server functions / server routes 内；表按规范加 GRANT + RLS，仅 service_role 可写，前端只经服务端函数读。
- PII 一律 SHA-256（小写去空格规范化）后入库与发送，符合两平台哈希要求。
- 适配器是唯一的平台耦合点：将来你提供 Google Developer Token / OAuth Refresh Token / Customer ID / Conversion Action，以及 Meta Dataset ID / System User Token，我只需新增 `LiveGoogleAdsAdapter` 与 `LiveMetaCapiAdapter` 两个文件并把 mode 切到 LIVE。
- campaigns / creative / 素材中心 现有模块不改动。
