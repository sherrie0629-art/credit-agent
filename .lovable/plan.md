# Google Ads 显示「未连接」的原因与处理

## 原因（已核实）

探活读取的是**服务端环境变量**（`process.env.GOOGLE_ADS_*`，故意不带 `VITE_` 前缀）。当前云端项目的密钥列表里只有 `LOVABLE_API_KEY`，五个 Google Ads 变量一个都没有配置，所以：

- `GOOGLE_ADS_MODE` 读不到 → 默认 `off` → 面板显示「未连接」
- 同时列出缺失项：DEVELOPER_TOKEN / CLIENT_ID / CLIENT_SECRET / REFRESH_TOKEN / CUSTOMER_ID

也就是说这不是 API 或代理故障，就是**云端预览环境里根本没放这几把钥匙**。你此前配置的是本地 `.env`，那份文件只对本机 `npm run dev` 生效，不会同步到 Lovable Cloud。

（`GOOGLE_ADS_LOGIN_CUSTOMER_ID` 没出现在缺失列表里，说明它不是必填项，只在使用测试 MCC 时需要。）

## 处理方案

两条路，按你的验收场景二选一：

**A. 只在本地联调（不改云端）**
在项目根 `.env` 补齐这些变量并重启 `npm run dev`，探活即显示真实状态。本地已经是只读模式，探活/查询没问题，结构同步写库需要 service role，仍建议到云端做。

**B. 让云端预览也能连 Google Ads（推荐，配合结构同步）**
把下列变量作为云端密钥写入，然后重新点「探活」：

- `GOOGLE_ADS_MODE` = `test`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`（测试广告主 CID，无横杠）
- 可选：`GOOGLE_ADS_LOGIN_CUSTOMER_ID`（测试 MCC）

我会通过安全表单请求这些值（值不会进代码库、不会出现在聊天里）。

## 技术说明

- 云端 Worker 运行时**不需要也不能用** `GOOGLE_ADS_PROXY`：SOCKS 代理只是为了绕开本机网络限制，云端直连 `googleads.googleapis.com`。所以云端不要设置该变量。
- 现有代码无需改动，`getGoogleAdsEnvStatus()` 会自动在变量齐备后返回 `configured: true`。
- 若你希望云端保持关闭、只做本地验收，也可以把 `GOOGLE_ADS_MODE` 留空/设为 `off`，面板显示「未连接」属预期行为，不算故障。

## 待确认

按 A 还是 B 走？选 B 我下一步就发起密钥填写表单。
