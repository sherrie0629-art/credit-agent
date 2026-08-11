# 批准执行为什么这么慢（以及怎么改）

## 点一次「批准执行」后端做了什么（已核实代码路径）

顺序全是串行 await：

1. 读这条决策行（`agent_decisions` 单条查询）
2. 写一条人工审批审计（`guardrail_events` insert）
3. 查是否属于「跨广告组再分配」卡（`pendingAllocationsFor`）
4. 读广告组、读风控限额（`agent_settings`）
5. 写一条风控判定审计（`guardrail_events` insert）
6. 调 Google Ads：先换 access token（OAuth token 端点，缓存过期就重新换），再读广告组行、读父系列行，然后 `googleAds:mutate` 改 CampaignBudget —— 走 REST，本地还要经 SOCKS 代理，跨境往返本身就是秒级
7. 再写一条「已推送 Google」审计
8. 回写 `ad_groups.daily_budget`、回写 `agent_decisions.status/guardrail_note`、写 `external_mutate_*`
9. **最后重新拉一次全量快照** `get_agent_snapshot()`（决策 100 条 + 所有系列/组/素材/指标/视图）再返回

大头是第 6 步（跨境 API，尤其 token 刷新那次）和第 9 步（整站快照）。前端 `DecisionCard` 在这期间只是把按钮 disable，没有任何进度文案，所以看起来像卡死。

## 改造方案

### 1. 前端立刻给反馈（体感收益最大）

- 按钮进入 loading 态：显示转圈 + 「正在推送 Google…」，并按秒数递增（复用素材中心「AI 正在出图…Ns」那套计时）。
- 点下即出一条 loading toast，成功/失败时用 `toast.success/error` 就地替换，不再是长时间静默。
- 卡片本身立即置灰并打上「执行中」状态标记，避免重复点击。

### 2. 把非关键路径挪出等待

- 三处审计写入（人工审批、风控判定、Google 推送）改为**不阻塞返回**：写库失败已经是吞掉的，不需要串行等待。
- 步骤 4 的「读限额」与步骤 3 的「查再分配」并行取，不必一前一后。

### 3. 返回值瘦身：不要在批准里重拉全量快照

- `approveDecision` 改为只返回**受影响的最小增量**：这条决策的新状态 / guardrail_note / external_mutate_*，以及被改的那个广告组的新预算。
- 前端 store 收到后本地打补丁（素材中心「本地 patch」已有先例），再在后台静默刷新一次完整快照。
- 这样返回时间少掉一整次 `get_agent_snapshot()`。

### 4. Google 调用加超时与状态提示

- 给 Ads REST 调用加显式超时（如 20s）并在超时时给出明确文案「Google 未响应，本地未改动」，而不是无限期挂着。
- token 缓存已存在，保留；只在过期时才刷新。

## 技术细节

- 涉及文件：`src/lib/creditagent/agent.server.ts`（approveDecision 返回结构）、`src/lib/creditagent/agent.functions.ts`、`src/lib/creditagent/store.ts`（增量 patch + 后台刷新）、`src/components/creditagent/DecisionCard.tsx`（loading/计时/toast）、`src/lib/creditagent/google-ads.server.ts`（超时）。
- 不改任何风控判定阈值、不改推送成功与否的判定顺序：**仍然先 Google 成功、再写本地**，失败整笔失败。
- 审计条数与内容不变，只是不再阻塞响应。
