# 菜单切换变慢的原因与优化方案

## 实测数据

| 场景 | 实测 |
| --- | --- |
| 首页 SSR（含快照数据） | 102 KB / 0.58 s |
| 归因页 SSR | 95 KB / 0.79 s |
| 缓存命中时的切页 | 0.27 ~ 0.42 s |
| 缓存过期时的切页 | 需等待一次完整快照请求（约 0.5 s+）后才渲染 |

数据体积已经不是问题（之前 4.9 MB 的 base64 图片问题已修复）。现在慢在**切页时机**上。

## 三个原因

### 1. 路由 loader 会阻塞导航（主因）
五个页面的 loader 都是 `return context.queryClient.ensureQueryData(agentSnapshotQuery)`。因为把 Promise 返回给了路由，router 会**等它完成**才切换页面。快照缓存 60 秒一过期，任何一次点菜单都会先卡住等待一次后端请求，页面在此期间完全没有反应——这正是"点了菜单半天不动"的体感。

### 2. 归因页 / 转化页要现拉图表库
`recharts` 只在 `/analytics` 和 `/conversions` 用到，是按需加载的独立代码块。第一次进这两个页面要额外下载并解析图表库，比其他页面明显慢一截。

### 3. 转化页串了两个请求
`/conversions` 的 loader 同时等待 `agentSnapshotQuery` 和 `conversionSnapshotQuery`，且后者 staleTime 只有 30 秒，过期概率更高。

## 优化方案

### A. loader 改为"不阻塞"预取
把五个页面的 loader 从"返回 Promise"改成"只触发预取、不返回"。效果：点菜单**立即**渲染页面（用 store 里已有的上一次数据），新数据到达后无感刷新。缓存命中时体感不变，缓存过期时从"卡 0.5 秒"变成"瞬时切换"。

### B. 悬停即预取
导航链接已开启 `preload: "intent"`，但 `defaultPreloadStaleTime: 0` 让预取每次都打后端。配合 A 之后，鼠标移到菜单上就已经在后台取数并把目标页代码块下载好，等真正点击时数据和代码都已就位。

### C. 图表库提前预热
在应用外壳挂载后空闲时机预加载 `/analytics`、`/conversions` 的路由代码块（`router.preloadRoute`），消除首次进图表页的额外等待。

### D. 快照刷新收敛
统一快照与转化快照的缓存策略（都设 60 秒、后台静默刷新），避免转化页因为两套过期时间反复触发请求。

## 预期效果

| 指标 | 现在 | 优化后 |
| --- | --- | --- |
| 缓存过期时切页 | 阻塞 0.5 s+ 白屏无反应 | 立即渲染，后台更新 |
| 首次进图表页 | 额外下载图表库 | 已预热，直接渲染 |
| 转化页 | 两个请求串行等待 | 不阻塞，先渲染 |

## 技术细节

- 改动文件：`src/routes/index.tsx`、`campaigns.tsx`、`creative.tsx`、`analytics.tsx`、`conversions.tsx`（loader 改为 void 预取）；`src/lib/creditagent/store.ts`（快照缓存策略）；`src/components/creditagent/AppShell.tsx`（空闲预热路由）；`src/router.tsx`（预取 staleTime）。
- 不改任何业务逻辑、不改数据库、不改页面展示内容。
- 注意：当前预览运行在开发模式，模块是逐个按需加载的，正式发布版本会打包合并，实际比预览更快；上述优化在两种模式下都有效。
