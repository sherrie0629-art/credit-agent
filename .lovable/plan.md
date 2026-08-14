# 素材中心：从主视觉生成短视频

在现有「变体 → 主视觉」链路上，加一条「主视觉 → 8 秒竖版短视频」能力，供 Reels / Shorts 投放使用。

## 用户看到的效果

- 素材卡片上，已有主视觉的变体多出一个「生成视频」按钮（没有主视觉时置灰，提示先出图）。
- 点击后卡片进入进度状态：提交中 → 生成中（约 1-3 分钟，带计时和进度百分比）→ 保存中 → 完成。期间可以离开页面，回来继续看到状态。
- 完成后卡片内嵌一个竖版播放器，可播放、下载，也可「重新生成」。
- 视频与图片变体同流程：文案合规判定沿用变体本身的合规状态，合规 FAILED 的变体不允许生成视频；生成结果作为该变体的附加资产参与实验/审批展示。

## 生成规格

- 模型：`google/veo-3.1-lite`（图生视频，最省的一档）
- 尺寸 `720x1280`（竖版 9:16），时长 `8` 秒，带音轨
- 提示词由变体的 headline / bodyText / angle 组合，加一段固定的信贷广告风格约束（真实感、暖光、可信、无文字叠加、无 logo）
- 起始帧：直接取该变体已存的主视觉字节，转成 base64 data URL 传给网关

## 成本与防滥用（重要）

视频生成比出图贵约两个数量级，所以：

- 只在用户显式点击时触发，绝不在页面加载、扫仓、Advisor 里自动跑
- 同一项目同时只允许 1 个生成任务在跑，第二次点击排队并提示
- 同一变体 24 小时内最多重生成 3 次
- 失败（含内容安全拦截）不自动重试，把网关的原因原样展示

## 数据与存储

新增一张 `creative_videos` 表（含 RLS 与 GRANT，写入只给 service_role，读走现有只读 RPC 口径）：

- `id`、`variant_id`、`job_id`、`status`（QUEUED/RUNNING/COMPLETED/FAILED）、`video_url`、`error_message`、`prompt`、`seconds`、`size`、`created_at`、`completed_at`

视频文件存进新的私有存储桶 `creative-videos`，路径 `variants/{variantId}/{jobId}.mp4`，通过与图片一致的公开读取路由代理输出（沿用 `/api/public/creative-video/$`），数据库只存短路径 —— 网关的下载地址约 1 小时过期，绝不入库。

## 技术改动点

- 迁移：`creative_videos` 表 + 存储桶 + RLS/GRANT
- `src/routes/api/generate-creative-video.ts`：POST 创建任务（读主视觉字节 → base64 → 调 `/v1/videos`），写库返回 `jobId`
- `src/routes/api/creative-video-status.ts`：GET 轮询网关任务；`completed` 时下载 MP4 → 上传存储桶 → 幂等写库，返回代理 URL
- `src/routes/api/public/creative-video/$.ts`：视频读取路由（Range 支持，长缓存）
- `src/lib/creditagent/video-storage.server.ts`：上传/读取/路径解析，参照 `image-storage.server.ts`
- `src/lib/creditagent/creative.server.ts` / `creative.functions.ts` / `store.ts`：快照带上每个变体的视频状态与 URL；生成完成后局部 patch，不重拉全量快照
- `src/components/creditagent/creative/CreativeLibraryTab.tsx`：按钮、分阶段进度、播放器、限流提示

## 不做的事

- 不做文生视频入口（本轮只做图生视频）
- 不做视频自动推送到 Google / Meta（沿用现有「平台建结构，Agent 只推预算与启停」的约定）
