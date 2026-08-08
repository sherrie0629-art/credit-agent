# 加速「生成主视觉」：出图与保存两段都压一压

## 现状（已核对代码）

一次点击串行做两件事，两段都在前台占用状态：

1. **出图**：`/api/generate-creative-image` 用 `google/gemini-3.1-flash-image`，虽开了 `stream: true`，但该模型只在完成时吐一整张图，中间没有渐进帧 —— 所以是十几秒纯等待，进度条也没东西可显示。
2. **保存**：`handleImage` 把整张 PNG（通常 2~3MB）原样 POST 到 `/api/save-creative-image`，服务端再上传对象存储并写库。传输 + 存储写入就是那几秒的「保存中…」。

## 优化方案

**A. 出图更快**
- 换成同系列最快的 `google/gemini-3.1-flash-lite-image`（Nano Banana 2 Lite）。它用 Vertex `generateContent` 请求体，路由里按该模型的正确 body 重写，并保留原模型作为失败回退。
- 提示词里显式限制画幅（正方形、卡片缩略图尺度），减少大图生成开销。

**B. 保存几乎瞬时**
- 上传前在浏览器里用 canvas 把图缩到 1200px 宽并编码成 **WebP(q≈0.85)**：体积从 2~3MB 降到 150~300KB，上传时间基本消失，服务端也不用再做降采样。
- 保存改成**完全后台**：图一出来就把预览贴上卡片、解除按钮锁定、不再显示「保存中…」；保存成功后静默把 store 里的 URL 换成正式地址，失败才弹 toast 并给「重试保存」。

**C. 等待更好受**
- 出图阶段换成带计时的骨架提示（如「AI 正在出图… 8s」），并配一句「通常 5-10 秒」，避免"卡住了"的错觉。

## 技术改动点

- `src/routes/api/generate-creative-image.ts`：切换模型 id 与对应请求体，失败回退到现模型。
- `src/components/creditagent/creative/CreativeLibraryTab.tsx`：新增 canvas 压缩工具、保存转后台（不阻塞按钮）、出图计时提示。
- `src/routes/api/save-creative-image.ts`：接受 `image/webp`（`x-image-type` 已透传，只需放宽扩展名处理）。
- 无数据库变更。

## 预期效果

出图 10~15s → 5~8s；保存 3~5s → 用户无感（后台完成）。
