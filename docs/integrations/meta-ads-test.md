# Meta Ads 测试账户 API（Phase 0–3）

CreditAgent 通过服务端直连 Meta Marketing API / Graph（**不接 MCP**）。默认关闭，本地/Cloud 显式打开后才打 API。

原则与 Google 一致：**不在 Agent 里创建并推回平台结构**；真实系列/广告组在 Meta 后台建，Agent 只读镜像；预算/暂停经审批后再推。Meta 日预算推送到 **Ad Set**（不是 Campaign）。

---

## Phase 0：进后台 + 开发者侧（手工，不写业务代码）

### 0.1 业务侧资产

1. 登录 [Meta Business Suite / Ads Manager](https://business.facebook.com/)。
2. 准备一个**可测广告账户**（建议低日预算；信贷类注意 Special Ad Categories）。
3. 记下 **Ad Account ID**：`act_123456789`（Ads Manager → 账户设置）。
4. 确认你的用户对该账户至少是**广告账户管理员**。

### 0.2 开发者应用

1. [developers.facebook.com](https://developers.facebook.com/) → 注册开发者 → **创建 Business 类型 App**。
2. Add Product → **Marketing API**。
3. 将 App 关联到拥有该广告账户的 Business。
4. Development + **Standard Access** 即可测自己管理的账户（多客户代操才需要 App Review / Advanced Access）。

### 0.3 Token

| 用途 | 做法 | 寿命 |
|------|------|------|
| 当天手工探活 | Graph API Explorer：选 App → User Token → `ads_read`（只读）或加 `ads_management`（写）→ Generate | ~1–2h |
| Agent / 脚本常驻 | 短 token 换长期 User Token（约 60 天），或 Business **System User** + 分配广告账户（生产首选） | 长 / 持久 |

权限最小集：`ads_read`；写入再加 `ads_management`；资产树常加 `business_management`。

**安全**：App Secret / token **禁止** `VITE_`、禁止提交 git。

### 0.4 Graph 手工验收

在 Graph API Explorer 或本机：

```bash
npm run test:meta-ads
```

（需已配置下方 env。）手工等价：

1. `GET /me`
2. `GET /me/adaccounts?fields=id,name,account_status,currency`
3. `GET /act_{ID}/campaigns?fields=id,name,status,objective`
4. `GET /act_{ID}/adsets?fields=id,name,campaign_id,status,daily_budget`
5. （可选）对测试 Ad Set 小改 `status` / `daily_budget`，Ads Manager 核对

常见失败：`(#274)` → 账户未挂到 App / 角色不够；token 过期；Development 下非管理员账户。

**`API access blocked`（OAuthException 200）**：这是 **App / 账号被 Meta 限制 Graph**，不是代理或本仓库 bug。典型表现：`GET /me`、`debug_token`、Marketing API 全部 400。处理：

1. [App Dashboard](https://developers.facebook.com/apps/) 看红条 / Required actions / 是否 Disabled。
2. 同一 App + token 在 [Graph API Explorer](https://developers.facebook.com/tools/explorer/) 测 `GET /me`。
3. Explorer 也失败 → 处理违规或新建 Business App，重新发带 `ads_read`（写再加 `ads_management`）的 token，更新 `META_ACCESS_TOKEN`。
4. 仅本机失败、Explorer 成功 → 再查代理出口 IP 是否被 Meta 拦（换节点后重试）。

---

## 环境变量（server-only）

```text
META_ADS_MODE=off          # off | test（默认 off）
META_APP_ID=
META_APP_SECRET=           # 换长期 token 时需要；System User 长期 token 可只配 ACCESS_TOKEN
META_ACCESS_TOKEN=         # 长期 User Token 或 System User Token
META_AD_ACCOUNT_ID=        # act_123... 或纯数字（代码会规范成 act_）
META_ADS_PROXY=            # 可选 socks5h://…；未设时回退 GOOGLE_ADS_PROXY / ALL_PROXY / HTTPS_PROXY
META_ADS_ALLOW_DIRECT=1    # 可选：无代理时允许直连
META_GRAPH_VERSION=v21.0   # 可选，默认 v21.0
```

`MODE=test` 且凭证不齐时，探活 UI 显示「未连接」+ 缺失项；写路径会失败（不假成功）。

---

## 结构同步（单向：Meta → Agent）

推荐路径：在 **Meta Ads Manager** 建系列 / Ad Set / 广告，再在 Agent「投放结构」点 **「从 Meta 同步结构」**。

| 能力 | 方向 | 说明 |
|---|---|---|
| 结构（系列 / Ad Set / 广告） | **只拉不推** | `origin=meta_sync` 镜像；结构页对同步数据只读 |
| 预算 / 暂停（托管） | **审批后推 Meta** | 推送到 **Ad Set** `daily_budget` / `status` |
| 本地演示 | **保留不动** | `origin=demo`；同步永不 UPDATE/DELETE 演示行 |

同步幂等 id：`m_cmp_{campaignId}` / `m_adg_{adsetId}` / `m_ad_{adId}`。  
Meta 侧已删资源软标记 `platform_removed=true`。

RPC：`syncMetaStructureFn` → `src/lib/creditagent/meta-ads-sync.server.ts`。  
需 `META_ADS_MODE=test` + 凭证齐 +（写库）`SUPABASE_SERVICE_ROLE_KEY`。

---

## 资源对上号

| 本地列 | Meta |
|---|---|
| `campaigns.meta_resource_name` | Campaign id（数字字符串） |
| `ad_groups.meta_resource_name` | **Ad Set id**（预算与启停目标） |
| `creative_assets.meta_resource_name` | Ad id |

`MODE=test` + channel=Meta + **未对上号** → 推送拒绝。

---

## 探活与写入验收

预算页「Meta Ads」面板：`pingMetaAdsFn`。

「生成写入验收卡片」：`seedMetaAdsWriteTestDecisions`（预算、暂停、CLAMP、DENY、未绑定）。熔断开启时批准不打 API。

---

## CAPI LIVE（Phase 3）

转化设置 `platform=meta` 且 `mode=LIVE` 时走 `LiveMetaCapiAdapter`（`graph.facebook.com/.../{dataset}/events`）。  
Marketing API 凭证与 CAPI 可用同一 `META_ACCESS_TOKEN`，或单独配转化设置里的 destination / token 字段。

---

## 明确不做

- Agent 向导新建冒充已推到 Meta  
- 未审批 / 熔断路径写正式户  
- 依赖 MCP 写路径  
