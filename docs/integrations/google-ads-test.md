# Google Ads 测试账户 API（Phase 1）

CreditAgent 通过服务端直连 Google Ads API（**不接 MCP**）。默认关闭，本地/Cloud 显式打开后才打 API。

## 环境变量（server-only）

写入 `.env` / `.env.local` 或 Lovable Cloud Secrets。**禁止** `VITE_` 前缀，**禁止**提交 `google-ads-oauth-tokens.txt`。

```text
GOOGLE_ADS_MODE=off          # off | test（默认 off）
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_LOGIN_CUSTOMER_ID=  # 测试 MCC，10 位数字，无横杠
GOOGLE_ADS_CUSTOMER_ID=        # 测试广告主 CID，无横杠
```

`MODE=test` 且凭证不齐时，探活 UI 显示「未连接」+ 缺失项；写路径会失败（不假成功）。

## 代理

本机若无法直连 `googleads.googleapis.com`，必须走 SOCKS（gRPC 客户端不认 `ALL_PROXY`；实现已改为 REST + `socks-proxy-agent`）。

在 `.env` 中配置并重启 `npm run dev`：

```bash
GOOGLE_ADS_PROXY=socks5h://127.0.0.1:10886
```

也可在启动前 `export ALL_PROXY=...`（代码会回退读取）。此前 Desktop OAuth 换 token 已验证代理必要。

## 测试户限制

- Test Account Access Developer Token 只能打测试户。
- 测试户通常**无真实展示/花费/转化**；复盘、PID、CPS 仍用本地快照，直到后续 spend-pull epic。
- 勿对正式 MCC/广告主开 `MODE=test` 验收。

## 结构同步（单向：Google → Agent）

推荐路径：**在 Google 后台建系列/广告组/广告**，再在 Agent「投放结构」点 **「从 Google 同步结构」**。

| 能力 | 方向 | 说明 |
|---|---|---|
| 结构（系列 / 组 / 广告树） | **只拉不推** | 写入 `origin=google_sync` 镜像行；结构页对同步数据**全部只读**（含预算/状态展示） |
| 预算 / 暂停（托管） | **审批后推 Google** | 主路径：Agent 提案 → 人批卡片 → 写库 →（MODE=test）推送；或预算矩阵人工入口。**不在结构页直改** |
| 本地演示数据 | **保留不动** | `origin=demo`；同步永不 UPDATE/DELETE 演示行；演示行仍可在结构页本地编辑（不写 Google） |

同步幂等 id：`g_cmp_{googleCampaignId}` / `g_adg_{googleAdGroupId}` / `g_ad_{googleAdId}`。  
Google 侧已删的资源会软标记 `platform_removed=true`，不物理删除（避免断决策历史）。

RPC：`syncGoogleStructureFn` → `src/lib/creditagent/google-ads-sync.server.ts`。  
前置：`GOOGLE_ADS_MODE=test` + 凭证齐 + 代理（如需）。结构同步要写库，需 `SUPABASE_SERVICE_ROLE_KEY`（Lovable Cloud 自动注入；本地 Cursor 默认为只读，请在云端预览验证，或自行配置 service_role）。

探活**不会**导入结构；结构请用一键同步。

## 资源对上号（resource）

本地 `campaigns.id` / `ad_groups.id` 是业务字符串，不是 Google ID。

| 本地列 | Google resource |
|---|---|
| `campaigns.google_resource_name` | `customers/{cid}/campaigns/{id}` |
| `campaigns.google_budget_resource_name` | `customers/{cid}/campaignBudgets/{id}` |
| `ad_groups.google_resource_name` | `customers/{cid}/adGroups/{id}` |
| `creative_assets.google_resource_name` | `customers/{cid}/adGroupAds/{id}`（同步写入） |

一键同步会自动填好上述字段。演示数据仍可手工粘贴（仅联调）。日预算推送改的是**系列 CampaignBudget**（Google 模型）。

`MODE=test` + channel=Google + **未对上号** → 推送 **拒绝**，绝不静默声称已改 Google。

## 探活

预算页「Google Ads」面板会调用 `pingGoogleAdsFn`：

- Off → 未连接
- Test + 凭证齐 → 列出 accessible customers 与 campaigns
- 错误 → 显示 API 错误摘要（含代理/权限问题）
- 探活成功 ≠ 结构已导入；请到投放结构一键同步

## 写路径（托管：预算 / 暂停）

护栏通过后：`setAdGroupBudget` / `setAdGroupStatus` / `approveDecision`（BUDGET_SHIFT、暂停类）在 `MODE=test` 且 Google 且已对上号时：

1. 先 Ads mutate  
2. 成功后再写 Supabase  
3. Ads 失败 → 整笔失败，本地不假成功  

Kill Switch（风控姿态 · 全局熔断）开启时不打 API（仅本地，文案标明）。

**不做**：从 Agent 创建系列/组/广告并推回 Google；Meta 结构同步；花费指标全量 pull。

## 写入路径点击验收

预算页 Google Ads 面板 → **「生成写入验收卡片」**（`seedGoogleAdsWriteTestDecisionsFn`）。

**前置：** `MODE=test` + 探活成功 + 已「从 Google 同步结构」且至少一组有 `google_resource_name`、父系列有 `google_budget_resource_name`。云端需 service role；本地只读时会提示无法写卡。

生成后队列出现带 `qa_gads_` 前缀的 PENDING 卡（再次生成会先驳回旧 qa 卡）：

| 卡 | 批准后预期 |
|---|---|
| A 小幅加预算 | toast 已推送 Google；测试户 CampaignBudget 微增；`external_mutate_status=PUSHED` |
| B 暂停广告组 | 测试户广告组 PAUSED；本地 status 同步。**恢复**请用预算页人工改状态（批准路径不推 ACTIVE） |
| C 护栏截断 | 目标超绝对上限 → CLAMP；推送截断值；卡上 `guardrail_note` |
| D 护栏拒绝 | 单次幅度超限 → **不推 Google**；卡上拒绝 note（仍可能保持 PENDING） |
| E 未对上号 | 挂 demo 无 resource 组；toast「未推送 Google」/ UNBOUND（无合适 demo 组则跳过） |

补充：

1. 将风控姿态切到「全局熔断」后再批一张应 `SKIPPED_KILL_SWITCH` / 不打 API。  
2. `MODE=off` 时批准预算类仅本地跳过推送。  
3. 在 Google 测试户 UI 核对预算与状态；决策行看 `external_mutate_*`。

## 验收清单

1. `MODE=off`：UI 显示未连接，改预算仅本地。  
2. `MODE=test` + 凭证：探活能列出 test CID 的 campaign。  
3. Google 后台建好结构 → Agent 一键同步 → 树出现且标 `Google`；演示数据仍在。  
4. Google 改名后再同步 → Agent 名称更新；删组后再同步 → 标记已移除。  
5. 对同步来的组：结构页**不能**直改预算/暂停；经审批卡片或预算矩阵改 → 测试户可见；在 Agent **新建**演示结构 → 只存本地。  
6. 未对上号批准 → 明确错误，不 toast「已推送 Google」。  
7. 按上文「写入路径点击验收」点生成并批准 A–E（及全局熔断 / MODE=off 补充项）。  
