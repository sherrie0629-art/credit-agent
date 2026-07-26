## 目标

把界面上剩余的英文标题、按钮、标签统一改成中文，只保留行业通用英文术语（Meta、Google、Agent、CPS、CPL、ROAS、ROI、API、AI）以及作为「机器风格」装饰的等宽小标签。

## 中英保留规则

- 保留英文：`Meta` / `Google` / `Agent` / `CPS` / `CPL` / `ROAS` / `ROI` / `LTV` / `API` / `AI` / `Human-in-the-Loop`
- 状态枚举值（`EXECUTED`、`PENDING_APPROVAL` 等）为数据库字段，界面上改为中文显示（已执行 / 待审批 / 已否决 / 已回滚），底层值不动
- `label-mono` 小写等宽标签（如 `module 04`、`disbursed`）属于设计语言的一部分，改为中文会破坏视觉；方案：保留编号类（`module 04`），把有实际含义的（`disbursed`、`confidence`、`trigger`、`agent runtime`）改成中文短词

## 逐文件改动

**src/components/creditagent/AppShell.tsx**
- 导航主标题改中文：决策指挥中心 / 预算与投放 / 合规素材 / 全链路归因，去掉原来的中文副标题重复
- 侧栏运行状态块：`AUTONOMOUS RUNNING` → 自动托管运行中，`PAUSED` → 已暂停，`mode = full-auto` → 模式：全自动 / 半自动，`poll = 15min` → 采集间隔：15 分钟

**src/components/creditagent/badges.tsx**
- `StatusBadge` 映射为中文；`AgentBadge` 保留 `Planner Agent` 等英文（术语）

**src/components/creditagent/DecisionCard.tsx**
- `thought chain · N steps` → 推理链 · N 步
- `confidence` → 置信度，`trigger` → 触发指标，`rollback snapshot` → 回滚快照
- 按钮：Approve → 批准，Override → 人工否决，Rollback → 回滚

**src/routes/index.tsx**
- H1 → AI 投放决策指挥中心；`AUTONOMOUS RUNNING` 徽标、`next poll` 中文化
- 四个指标卡标签：今日 AI 接管次数 / CPS 降幅 / 待审批决策 / 合规拦截
- 两个面板标题：实时决策推理流 / 人工审批队列（Human-in-the-Loop）；`QUEUE EMPTY` → 队列已清空

**src/routes/campaigns.tsx**
- 页面标题、表头、模式切换、按钮与 toast 文案中文化（渠道名保留 Google/Meta）

**src/routes/compliance.tsx**
- 页面标题、扫描结果分区、规则说明、按钮（一键修复 / 提交投放）中文化
- 示例广告文案本身保留英文（它是被审核的英文素材，属于业务真实场景）

**src/routes/analytics.tsx**
- 页面与图表标题：全链路归因 / 转化漏斗 / 前端 ROI 与真实 ROAS 对比 / 渠道拆解
- 卡片标签：放款金额、CPS、通过率；`INSIGHT` → 洞察

## 技术说明

纯展示层文案替换，不引入 i18n 库，不改数据结构、server function 或数据库；`head()` 里的 title/description 已是中文，只补齐个别英文标题。
