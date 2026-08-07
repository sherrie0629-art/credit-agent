# 「生成主视觉」为什么慢，以及怎么优化

## 时间花在哪（已核对代码）

点一次按钮实际串行做了 4 件事：

1. **AI 出图**：`/api/generate-creative-image` 调用 `google/gemini-3.1-flash-image`，虽然开了 `stream: true`，但 Gemini 只在生成完成时吐出整张图，中途没有渐进预览 —— 所以界面看上去是"干等"。这一段通常占大头（十几到几十秒）。
2. **把 2~3MB 的 base64 图片经 RPC 传回服务端**（`setVariantImage`），传输本身就要几秒。
3. **服务端纯 JS 处理图片**：`image-transform.server.ts` 解 PNG、逐像素盒式降采样到 1200px、再编码 PNG。这是当前的 CPU 密集环节，一张大图在边缘运行时可能要数秒。
4. **保存完再拉一次全量快照**：`setVariantImage` 结尾 `getSnapshot()`，前端 `applySnapshot` 整表替换，又是一次完整往返。

第 2~4 步都发生在图已经生成之后，但 loading 状态一直没结束，所以体感被拉长了近一倍。

## 优化方案

**A. 让等待可见（体感）**
- 出图阶段显示进度骨架 + 分阶段文案（生成中 → 优化中 → 保存中），而不是一个转圈。
- 图片流一返回就立刻把预览贴到卡片上（已有 `preview` 状态），后续保存在后台进行，按钮不再锁死。

**B. 缩短真实耗时**
- 换更快的图像模型 `google/gemini-3.1-flash-lite-image`（同系列最快/最省），质量对广告主视觉足够；保留现在的模型作为可选。
- 保存改为"先落库、后台优化"：直接把原始字节存进对象存储并写库返回，图片降采样挪到读取路由的缩略图分支（已有 `?w=`）按需做，去掉保存链路上的同步 CPU 开销。
- `setVariantImage` 不再返回全量快照，只返回 `{ variantId, imageUrl }`，前端局部 patch 变体，省掉一次几百 KB 的快照往返。
- 把 base64 上传改成向服务端路由 POST 二进制（`application/octet-stream`），比 base64 少约 33% 体积，也避开 RPC 序列化。

## 技术改动点

- `src/routes/api/generate-creative-image.ts`：切换模型 id。
- 新增 `src/routes/api/save-creative-image.ts`（二进制上传接收，内部调用 `uploadVariantImage`）。
- `src/lib/creditagent/image-storage.server.ts`：上传时不再同步调用 `optimizeForStorage`。
- `src/lib/creditagent/creative.server.ts` / `creative.functions.ts` / `store.ts`：`setVariantImage` 返回轻量结果，store 局部更新。
- `src/components/creditagent/creative/CreativeLibraryTab.tsx`：分阶段进度提示、生成完即解锁按钮。

## 预期效果

保存后的固定开销从 ~5-10s 降到 ~1s 以内；换轻量模型后出图本身可再快 30-50%；用户在图出来的瞬间就能看到画面，而不是等全部落库。
