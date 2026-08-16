# 素材变体卡片媒体区美化方案

用户已选定「标签网格式」方向（v3）：把左侧主视觉图与右侧短视频锁定在同一高度容器内，按 16:9 / 9:16 的固有比例分配宽度，并加上图注标签与播放按钮遮罩。

## 目标

修复 `/creative?tab=library` 中 AI 变体卡片里「左侧横版图与右侧竖版视频高度不齐、视觉失衡」的问题，同时保留现有功能：

- 图片与视频均保持原始宽高比，不拉伸。
- 视频仍可点击播放（保留 `<video controls>` 或播放遮罩）。
- 重新生成主视觉 / 重新生成短视频 / 送去合规审查 三个按钮位置不变。
- 合规评分、变体状态、复选框等现有元素不受影响。

## 改动范围

仅修改 `src/components/creditagent/creative/CreativeLibraryTab.tsx` 中渲染变体卡片媒体区的局部 JSX（约第 866–947 行）。

## 具体实现

1. **统一媒体条容器**
   - 用 `flex gap-3 h-44`（或 `h-48`）包裹主视觉与视频。
   - 左侧图片容器：`flex-[3] relative rounded-xl overflow-hidden border border-border/60`。
   - 右侧视频容器：`flex-1 relative rounded-xl overflow-hidden border border-border/60`。

2. **主视觉图**
   - 图片使用 `w-full h-full object-cover`。
   - 增加从下到上的暗角渐变 `bg-gradient-to-t from-black/60 via-transparent to-transparent`，避免白色图与标签冲突。
   - 左下角增加「主视觉」标签：`absolute bottom-2 left-2`。

3. **短视频**
   - 视频元素使用 `w-full h-full object-cover`。
   - 在视频上方叠加半透明黑色遮罩，hover 时加深。
   - 中央放置玻璃态播放按钮，hover 时放大。
   - 右下角增加「短视频」标签。
   - 保留视频加载失败后的 blob fallback 逻辑。

4. **状态保持**
   - 生成中的占位状态（Loader / 文字提示）仍按当前逻辑显示。
   - 仅当 `hasHero && hasVideo` 时采用新并排布局；只有视频或只有图片时保持原有单媒体展示。

## 验收标准

- 同一变体卡片内，图片与视频顶部、底部严格对齐。
- 图片未被压扁或裁切到主体不可见；视频仍为 9:16 竖版。
- 视频播放控件可正常点击。
- 重新生成、合规审查按钮仍可操作。
- 无新增 TypeScript 或 ESLint 错误。
