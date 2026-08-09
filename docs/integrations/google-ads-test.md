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

本机若无法直连 `googleads.googleapis.com`，需 SOCKS/HTTP 代理，例如：

```bash
export ALL_PROXY=socks5h://127.0.0.1:10886
npm run dev
```

此前 Desktop OAuth 换 token 已验证代理必要。

## 测试户限制

- Test Account Access Developer Token 只能打测试户。
- 测试户通常**无真实展示/花费/转化**；复盘、PID、CPS 仍用本地快照，直到后续 spend-pull epic。
- 勿对正式 MCC/广告主开 `MODE=test` 验收。

## 资源绑定

本地 `campaigns.id` / `ad_groups.id` 是业务字符串，不是 Google ID。

| 本地列 | Google resource |
|---|---|
| `campaigns.google_resource_name` | `customers/{cid}/campaigns/{id}` |
| `campaigns.google_budget_resource_name` | `customers/{cid}/campaignBudgets/{id}` |
| `ad_groups.google_resource_name` | `customers/{cid}/adGroups/{id}` |

在「投放结构」编辑器中手工粘贴绑定。日预算推送改的是**系列 CampaignBudget**（Google 模型），不是 Ad Group 字段。

`MODE=test` + channel=Google + **未绑定** → mutate **拒绝**，绝不静默声称已推 Google。

## 探活

预算页「Google Ads」面板会调用 `pingGoogleAdsFn`：

- Off → 未连接
- Test + 凭证齐 → 列出 accessible customers 与 campaigns
- 错误 → 显示 API 错误摘要（含代理/权限问题）

## 写路径

护栏通过后：`setAdGroupBudget` / `setAdGroupStatus` / `approveDecision`（BUDGET_SHIFT、暂停类）在 `MODE=test` 且 Google 且已绑定时：

1. 先 Ads mutate  
2. 成功后再写 Supabase  
3. Ads 失败 → 整笔失败，本地不假成功  

Kill Switch 开启时不打 API（仅本地，文案标明）。

## 验收清单

1. `MODE=off`：UI 显示未连接，改预算仅本地。  
2. `MODE=test` + 凭证：探活能列出 test CID 的 campaign。  
3. 绑定 resource name 后批准预算决策 → 测试户 UI 可见日预算变化。  
4. 未绑定批准 → 明确错误，不 toast「已推送 Google」。  
