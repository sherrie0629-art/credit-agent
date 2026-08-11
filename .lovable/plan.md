# Google Ads 两端并存：本地 .env + 云端 Secrets（一次配置，永不切换）

## 为什么现在显示「未连接」

探活读的是服务端环境变量 `process.env.GOOGLE_ADS_*`（故意不带 `VITE_`）。云端密钥列表里目前只有 `LOVABLE_API_KEY`，五个 Google Ads 变量一个都没有，所以 `GOOGLE_ADS_MODE` 取默认值 `off`，并列出缺失项。你配的是本机 `.env`，那份文件只对 `npm run dev` 生效，不会同步到 Lovable Cloud。

不是 API 故障，也不是代理问题——只是云端这一侧还没放钥匙。

## 选哪种方案：两边各配一次，代码不做任何环境判断

推荐做法是「同名变量、两处各存一份」，配完之后来回切换零操作：

| | Cursor 本地 | Lovable 云端 |
|---|---|---|
| 变量来源 | 项目根 `.env`（已 gitignore） | Cloud Secrets |
| 谁来配 | 你（已完成） | 我发安全表单，你填一次 |
| 生效方式 | `npm run dev` 自动加载 | 预览/发布运行时注入 |
| 代理 | 需要 `GOOGLE_ADS_PROXY` | **不要设**，云端直连 |

代码侧无需改动：`getGoogleAdsEnvStatus()` 只认 `process.env`，谁给值就用谁的。所以在 Cursor 跑就读 `.env`，在 Lovable 跑就读 Cloud Secrets，不存在「切换」这个动作，也不需要注释/改开关。

这比另外两种做法都稳：
- 只配本地 → 云端预览永远 Off，结构同步（要写库、需 service role）做不了；
- 只配云端 → 本地探活永远 Off，Cursor 里没法联调。

## 需要你填的云端变量

- `GOOGLE_ADS_MODE` = `test`
- `GOOGLE_ADS_DEVELOPER_TOKEN`
- `GOOGLE_ADS_CLIENT_ID`
- `GOOGLE_ADS_CLIENT_SECRET`
- `GOOGLE_ADS_REFRESH_TOKEN`
- `GOOGLE_ADS_CUSTOMER_ID`（测试广告主 CID，无横杠）
- 可选：`GOOGLE_ADS_LOGIN_CUSTOMER_ID`（测试 MCC；当前未列为缺失，说明非必填）

值通过安全表单提交，不进代码库、不出现在聊天里。填完点「探活」即可看到 Test·已连接。

## 我会做的事

1. 发起密钥填写表单（上述 6~7 项）。
2. 在 `.env.example` 和 `README.md` 的本地调试段落里补一段「双环境说明」：同名变量本地/云端各一份，云端不要配 `GOOGLE_ADS_PROXY`，本地写入类操作仍是只读模式。
3. 不改任何业务代码。

## 一点提醒

云端 Worker 运行时不能用 SOCKS 代理，`socks-proxy-agent` 那条分支只在本地生效；若误把 `GOOGLE_ADS_PROXY` 配到云端，探活会超时报错。密钥更新后，预览立即生效，正式站需要重新发布一次。
