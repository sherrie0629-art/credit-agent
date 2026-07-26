## 目标

把「合规素材」和「创意实验室」合并成一个模块：**素材中心（Creative Hub）**，导航从 5 项减到 4 项。素材的全生命周期在一个页面内闭环：素材库 → 疲劳预警 → AI 变体生成 → 合规审计 → A/B 实验上线。

## 信息架构

单一路由 `/creative`（module 03），页面内用三个标签页组织，纯前端整合，不改动任何后端逻辑与数据表：

```text
素材中心 /creative
├── 素材库与疲劳雷达（默认）
│    素材卡片列表 = 现「疲劳雷达」+ 现「素材库」合并
│    每张卡：疲劳分/信号、合规状态徽章、AI 变体、
│           操作：AI 生成变体 / 上线 A/B / 送去合规审查
├── 合规审计
│    现 /compliance 全部内容（草稿编辑、实时评分、规则清单、
│    一键修复、提交广告 API），去掉重复的底部「素材库」区块
└── A/B 实验看板
     现创意实验室的实验表格与结算按钮
```

跨标签联动：素材卡的「送去合规审查」会把该素材（或某个 AI 变体）填入合规草稿并切到「合规审计」标签；合规通过后可直接回到素材库。标签状态放在 URL search param（`?tab=library|compliance|experiments`），可分享、可后退。

## 文件改动

- 新增 `src/routes/creative.tsx`：合并页，含 `head()` 元数据（标题/描述/og）。
- 新增 `src/components/creditagent/creative/`：
  - `CreativeLibraryTab.tsx`（疲劳雷达 + 素材库 + 变体卡，来自 creative-lab.tsx）
  - `ComplianceTab.tsx`（来自 compliance.tsx，接收 `draft/setDraft` 由父级持有以支持联动）
  - `ExperimentsTab.tsx`（实验看板）
- 删除 `src/routes/compliance.tsx`、`src/routes/creative-lab.tsx`。
- `AppShell.tsx`：导航合并为「素材中心 / 合规审计·疲劳迭代·A-B 实验」一项（图标 FlaskConical）。
- 旧链接兼容：`src/routes/compliance.tsx`、`creative-lab.tsx` 不保留重定向（站内无外链引用），如需保留可各留一个 `redirect` 到 `/creative?tab=...`。
- `sitemap[.]xml.ts`：更新 URL 列表。

## 技术说明

- store（`src/lib/creditagent/store.ts`）、server functions、fatigue/compliance 逻辑、数据表全部不动，只做 UI 组合。
- 标签用现有 shadcn `Tabs` 组件，配合 `Route.useSearch()` + `navigate({ search })` 同步状态。
- 三个 Tab 组件均从同一个 `useAgentStore` 读取，天然共享数据，无需额外状态提升，除合规草稿 `draft` 由 `/creative` 页面持有以实现跨标签联动。
