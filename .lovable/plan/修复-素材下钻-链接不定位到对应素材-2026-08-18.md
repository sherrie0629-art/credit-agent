# 修复「素材下钻」链接不定位到对应素材

## 现状（已核对代码）

- 运营看板的下钻链接（`OpsAnalyticsTab.tsx` 中 `ChannelCreatives`）跳转目标是 `to="/creative"`，`search={{ tab: "library" }}`，**只带了页签、没带素材 ID**。
- `/creative` 路由的 `validateSearch` 只接受 `tab` 一个参数，其他参数会被丢弃。
- 素材库（`CreativeLibraryTab.tsx`）按顺序平铺渲染全部素材卡片，没有锚点、没有高亮、也没有单素材筛选。

所以点击后确实会跳到素材中心的「素材库」页签，但页面停在列表顶部，看起来就像「没跳到对应内容」。

## 修复方案

1. **链接带上素材 ID**：下钻链接改为 `search={{ tab: "library", creativeId: p.creativeId }}`。
2. **路由接收参数**：`/creative` 的 `validateSearch` 增加可选 `creativeId`（字符串，非法值忽略）。
3. **素材库响应定位**：
   - 每张素材卡片加上 `id={`creative-${c.id}`}` 与 ref。
   - 读取 `creativeId` 后：滚动到对应卡片（`scrollIntoView({ block: "center" })`），并给它加一圈高亮描边（约 3 秒后淡出）。
   - 顶部显示一条「正在查看：<素材标题> ／ 显示全部」的提示条，点「显示全部」清除 `creativeId` 参数。
   - 若该 ID 在当前数据里不存在，提示条显示「未找到该素材」，列表正常展示全部。

## 技术细节

- 涉及文件：`src/routes/creative.tsx`、`src/components/creditagent/analytics/OpsAnalyticsTab.tsx`、`src/components/creditagent/creative/CreativeLibraryTab.tsx`。
- 通过 `Route.useSearch()` 在素材中心页读取参数并透传给 `CreativeLibraryTab`（新增可选 prop `focusCreativeId`），避免组件直接耦合路由。
- 滚动放在 `useEffect` 内，依赖 `focusCreativeId` 与素材列表加载完成状态，确保数据到位后再定位。
- 纯前端展示层改动，不涉及数据库与业务逻辑。
