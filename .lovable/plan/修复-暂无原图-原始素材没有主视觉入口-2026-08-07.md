# 修复「暂无原图」：原始素材没有主视觉入口

## 结论：不是脏数据，是逻辑链条缺一环（已核查数据库）

数据库里 3 个原始素材的主视觉字段现状：

- `crv_g_01`：有图（`/api/public/creative-image/variants/crv_g_01.png`）
- `crv_m_02`：空
- `crv_reels_88`：空

变体表里 6 条有 5 条有图。所以图片存储、读取路由、历史迁移都是正常的，问题在于：

1. 原始素材的主视觉从来只有「历史种子数据自带」这一个来源，`crv_g_01` 是当初手工/脚本补过图，另外两个从建表起就是空。
2. 界面上「生成主视觉」按钮只挂在 **AI 变体卡片** 上，原始素材卡片没有任何生成入口，因此空了就永远空着。
3. 只有 A/B 实验产生赢家并晋升时，赢家变体的图才会回写到原始素材——这两个素材没跑完实验，所以一直没有图。

也就是说：逻辑上原始素材**并不保证**有图，缺口是缺入口，不是数据被写坏。

## 修复方案

1. 在素材库的原始素材卡片上补一个「生成主视觉 / 重新生成」按钮，复用变体已有的那套流程（流式生成 → 直接二进制上传 → 本地局部刷新），只是落库目标从 `creative_variants` 换成 `creative_assets`。
2. 保存接口 `/api/save-creative-image` 增加一个 `kind=asset|variant` 参数，按 kind 决定更新哪张表；默认仍是 variant，不影响现有调用。
3. 空图占位保持现在的样式，但文案改成可操作提示（「暂无原图，点击生成」），并在生成过程中复用分阶段状态提示。
4. 生成提示词沿用素材自身的 headline + body 文案，保证视觉与文案一致。

## 技术说明

- 改动文件：`src/components/creditagent/creative/CreativeLibraryTab.tsx`（原始素材卡片按钮 + 复用 handleImage，抽成同时支持 asset/variant）、`src/routes/api/save-creative-image.ts`（新增 kind 分支）、`src/lib/creditagent/store.ts`（新增 `setAssetImageUrl` 局部 patch）。
- 数据库无需迁移；`creative_assets.image_url` 字段已存在。
- 存量两条空数据在界面上点一次「生成主视觉」即可补齐，不做批量后台补图，避免一次性消耗额度。

## 验证

- 在素材中心对 `crv_m_02`、`crv_reels_88` 各点一次生成，确认出图、刷新后仍在。
- 确认变体卡片的生成流程未受影响。
