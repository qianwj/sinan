# Web 视觉规范：虚拟 Agent 办公室

> **文档性质**：[`web-agent-office.md`](web-agent-office.md) §6 的具体化设计代币（颜色 / 排版 / 图标 / 动效 / 间距）。实现阶段以此为对照表。
> **基线**：[`web-agent-office.md`](web-agent-office.md) v0.2（§5 工位视图、§6 状态视觉语言、§7 决策收件箱、§11 可访问性）、[`architecture.md`](architecture.md) §10（安全、隐私与性能）。
> **不覆盖**：具体前端框架、组件库、CSS-in-JS 方案、构建工具、设计工具（Figma 等）的工程导出。
> **版本**：v0.1 ｜ **状态**：评审中 ｜ **更新**：2026-09-04

## 1. 文档规则

1. 视觉规范是 [`web-agent-office.md`](web-agent-office.md) §6 的具象化。任何与 §6 冲突的视觉决策以 §6 为准，本文档不重写语义。
2. 所有视觉代币（颜色、字号、时长、间距）都必须以**语义命名**暴露，不暴露裸值。前端实现可以基于 Tailwind / CSS Variables / 设计 Token JSON 落地。
3. **占位调色板**用于首期交付，可整组替换为定制品牌色而无需触动语义层（§4.1）。
4. 视觉元素必须可被屏幕阅读器、键盘、`prefers-reduced-motion`、`prefers-color-scheme` 替代（`web-agent-office.md` §11.1）。
5. 每个视觉决策至少有一个 `NFR-*` 或 `REQ-*` 锚点；纯装饰元素不进入基线（`web-agent-office.md` §1）。

## 2. 设计目标

| 维度 | 定义 | 主要锚点 |
|---|---|---|
| **可解释** | 颜色、图标、动效都对应明确的语义；用户能从视觉反向推断"这个状态意味着什么" | `NFR-02`、`web-agent-office.md` §6.1 |
| **可访问** | WCAG AA 对比度；色盲安全；动画可完全关闭；键盘可达 | `web-agent-office.md` §11.1 |
| **稳定** | 主题切换、明暗切换、动画开关下，语义与布局不漂移 | `architecture.md` §10.3 |
| **可替换** | 占位调色板可在不动业务逻辑的前提下整组替换 | `architecture.md` §11 |
| **不抢戏** | 拟人化、装饰性动画、KPI 化视觉一律禁止 | `web-agent-office.md` §3.2、§13 |

## 3. 代币总览

设计代币分为五个族。每族内部按"用途 / 角色"分层命名：

```text
颜色 (Color)        ── semantic.<role>.<intent>.<variant>
排版 (Typography)   ── typography.<role>.<size>.<weight>
图标 (Icon)         ── icon.<family>.<name>
动效 (Motion)       ── motion.<duration> | motion.<easing>
间距 (Spacing)      ── space.<n>          ── n 是 4px 倍数
```

代币命名遵循 `tailwind-style` 的 `<category>-<role>-<intent>-<variant>` 习惯，便于工程落地（CSS Variables / Tailwind config / Style Dictionary 通用）。

代币不在主题间混用。`light` 与 `dark` 是同一代币的两个解析值，由主题层决定当前生效值（§4.6）。

## 4. 颜色

### 4.1 命名与分类

颜色代币分为四层：

| 层 | 命名空间 | 含义 | 例 |
|---|---|---|---|
| **palette** | `palette-<hue>-<shade>` | 原始色阶（占位调色板，可整组替换） | `palette-slate-500` |
| **semantic** | `color-<role>-<intent>` | 语义槽位，与业务状态绑定 | `color-status-danger-fg` |
| **component** | `color-<component>-<part>` | 组件级映射，仍引用 semantic | `color-workstation-border` |
| **utility** | `color-<utility>` | 一次性工具色（分隔线、overlay） | `color-divider` |

**核心约束**：

- 业务代码只引用 `semantic` / `component` / `utility`，**永远不**直接引用 `palette`；
- 占位调色板（§4.2）替换时，只改 `palette` → `semantic` 的解析映射，业务代码不动；
- 任何颜色都必须有可读的文本对比伙伴（§4.7）。

### 4.2 占位调色板

> **基线选型**：slate 中性 + 标准 hue（评审答复，2026-09-04）。
> **理由**：slate 中性在明暗双主题下中性度高，不抢状态色；hue 选择与 Tailwind 默认对齐，便于实现阶段直接落地或一键替换。

#### 4.2.1 中性（slate）

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `palette-slate-50` | `#f8fafc` | `#f8fafc` | canvas / 极少用 |
| `palette-slate-100` | `#f1f5f9` | `#f1f5f9` | 弱背景 |
| `palette-slate-200` | `#e2e8f0` | `#e2e8f0` | 分隔线 |
| `palette-slate-300` | `#cbd5e1` | `#cbd5e1` | 边框 |
| `palette-slate-400` | `#94a3b8` | `#94a3b8` | 弱前景 |
| `palette-slate-500` | `#64748b` | `#64748b` | 次要前景 |
| `palette-slate-600` | `#475569` | `#475569` | 强次要前景 |
| `palette-slate-700` | `#334155` | `#334155` | 强前景 |
| `palette-slate-800` | `#1e293b` | `#1e293b` | 表面-1 |
| `palette-slate-900` | `#0f172a` | `#0f172b` | 表面-2 |
| `palette-slate-950` | `#020617` | `#020617` | 画布深 |

**主题解析**：

```text
color-bg-canvas       = palette-slate-50   (light) | palette-slate-950 (dark)
color-bg-surface      = #ffffff            (light) | palette-slate-900 (dark)
color-bg-elevated     = #ffffff            (light) | palette-slate-800 (dark)
color-fg-default      = palette-slate-900  (light) | palette-slate-100 (dark)
color-fg-muted        = palette-slate-600  (light) | palette-slate-400 (dark)
color-fg-subtle       = palette-slate-400  (light) | palette-slate-500 (dark)
color-border-default  = palette-slate-200  (light) | palette-slate-800 (dark)
color-border-strong   = palette-slate-300  (light) | palette-slate-700 (dark)
color-overlay         = rgba(15,23,42,0.5) (light) | rgba(0,0,0,0.7)   (dark)
```

#### 4.2.2 状态色（actor 状态 → hue）

| 槽位 | hue | 用途 |
|---|---|---|
| `sky` | 信息色 | `running`、进行中提示 |
| `amber` | 警示色 | `paused`（系统触发）、`failed`、决策 warning |
| `red` | 危险色 | `quarantined`、未知外部副作用 |
| `emerald` | 成功色 | 仅在显式确认完成时使用（如交付成功） |
| `slate` | 中性色 | `ready` / `created` / `paused`（用户）/ `terminated` |

色阶值复用 §4.2.1 的 slate 思路，固定取 100/500/700/900：

| Token | Light | Dark |
|---|---|---|
| `palette-sky-100` | `#e0f2fe` | `#e0f2fe` |
| `palette-sky-500` | `#0ea5e9` | `#0ea5e9` |
| `palette-sky-700` | `#0369a1` | `#0369a1` |
| `palette-sky-900` | `#0c4a6e` | `#0c4a6e` |
| `palette-amber-100` | `#fef3c7` | `#fef3c7` |
| `palette-amber-500` | `#f59e0b` | `#f59e0b` |
| `palette-amber-700` | `#b45309` | `#b45309` |
| `palette-amber-900` | `#78350f` | `#78350f` |
| `palette-red-100` | `#fee2e2` | `#fee2e2` |
| `palette-red-500` | `#ef4444` | `#ef4444` |
| `palette-red-700` | `#b91c1c` | `#b91c1c` |
| `palette-red-900` | `#7f1d1d` | `#7f1d1d` |
| `palette-emerald-100` | `#d1fae5` | `#d1fae5` |
| `palette-emerald-500` | `#10b981` | `#10b981` |
| `palette-emerald-700` | `#047857` | `#047857` |
| `palette-emerald-900` | `#064e3b` | `#064e3b` |

**红色使用边界**：红色只用于 `quarantined`（actor 状态）与"未确认的外部副作用"（决策项）（`web-agent-office.md` §6.1）。其他告警一律走 amber。`failed` 是 amber + 边框，不是红底——避免红色泛滥稀释信号。

#### 4.2.3 角色色

> 用于工位卡片的**身份色**（边框 / 图标色调），与**状态色**（背景 / 边框权重）独立（`web-agent-office.md` §5.3）。
> 颜色不是角色识别的唯一信号；身份识别靠**图标 + 文本标签**（`web-agent-office.md` §6.1）。

| 角色 | hue | 100 (Dark 前景) | 500 (Light 前景) | 700 (Light 强调) |
|---|---|---|---|---|
| `product_manager` | blue | `#60a5fa` | `#3b82f6` | `#1d4ed8` |
| `designer` | violet | `#a78bfa` | `#8b5cf6` | `#6d28d9` |
| `development_engineer` | cyan | `#22d3ee` | `#06b6d4` | `#0e7490` |
| `qa_engineer` | lime | `#a3e635` | `#84cc16` | `#4d7c0f` |
| `devops_engineer` | orange | `#fb923c` | `#f97316` | `#c2410c` |

**色盲安全声明**：本组合避免红绿轴（将 qa 从 emerald 移到 lime），并保证 hue 间隔 ≥ 30°。在 deuteranopia / protanopia 模拟下，五个角色仍有可区分的明度与色相差（亮度排序：devops > qa > dev > designer > pm）。识别主信号仍是图标 + 标签。

### 4.3 状态色语义映射

按 `web-agent-office.md` §6.1 的语义 → 代币表：

| Actor 状态 | bg | fg | border | 图标 | 备注 |
|---|---|---|---|---|---|
| `ready` / `created` | `color-bg-surface` | `color-fg-muted` | `color-border-default` | `icon-status-idle` | 低视觉权重 |
| `running` | `color-status-info-bg` (sky-100/900) | `color-status-info-fg` (sky-700/300) | `color-border-default` | `icon-status-running` | 中性 + 进度 |
| `paused`（用户） | `color-bg-surface` | `color-fg-default` | `color-border-strong` | `icon-status-paused-user` | 中等权重 |
| `paused`（lease / 策略） | `color-status-warning-bg` (amber-100/900) | `color-status-warning-fg` (amber-700/300) | `color-border-warning` (amber-500) | `icon-status-paused-system` | 高权重 |
| `failed` | `color-status-warning-bg` | `color-status-warning-fg` | `color-border-warning` 2px | `icon-status-failed` | 高权重 + 加粗边框 |
| `quarantined` | `color-status-danger-bg-solid` (red-600/800) | `color-fg-on-danger` (#fff) | `color-border-danger` (red-700/500) | `icon-status-quarantined` | 最高权重 |
| `terminated` | `color-bg-subtle` (slate-100/900) | `color-fg-subtle` | `color-border-default` | `icon-status-terminated` | 低对比，不需注意 |
| `restarting` | `color-bg-surface` | `color-fg-muted` | `color-border-default` | `icon-status-restarting` | 短暂态，弱提示 |

> 注：`color-status-danger-bg-solid` 是实心红底（区别于 failed 的弱背景），用以传达"不可自动恢复"。

### 4.4 角色色应用

| 元素 | 应用 | 备注 |
|---|---|---|
| 工位卡片左缘 / 顶条 | `palette-<role>-500` 边框 2px | Light 主题下；Dark 主题用 100 阶 |
| 工位卡片头部图标 | `palette-<role>-500` | 不染色背景 |
| 角色徽标 | `palette-<role>-100` 背景 + `palette-<role>-700` 文本 | 用于角色列表、详情头部 |
| 决策项"受影响 actor"列 | 每个 actor 引用自己的角色色边框小圆点 | 与卡片样式保持一致 |

**约束**：

- 角色色不能用作"进度"或"完成度"等业务信号；那是状态色的工作；
- 角色色不替代状态色；状态色永远优先（`web-agent-office.md` §5.3 身份色与状态色独立）。

### 4.5 决策严重度色

决策严重度由治理层计算（`web-agent-office.md` §7.2），UI 仅渲染。严重度槽位：

| 槽位 | 来源 | bg | fg | border | 图标 | 备注 |
|---|---|---|---|---|---|---|
| `decision-critical` | 未确认外部副作用 | `color-status-danger-bg-solid` | `#fff` | red-700 | `icon-decision-critical` | 红色，严格对齐"未确认副作用 = 红色"规则 |
| `decision-high` | 阻塞任务 ≥ N | `color-status-warning-bg` | amber-700/300 | amber-500 | `icon-decision-high` | amber |
| `decision-medium` | 需求冻结窗口 | `color-status-info-bg` | sky-700/300 | sky-500 | `icon-decision-medium` | sky |
| `decision-warning` | 紧迫时间 | `color-status-warning-bg` 弱 | amber-700/300 | amber-300 | `icon-decision-warning` | amber 弱 |
| `decision-info` | 默认 / 低阻塞 | `color-bg-surface` | `color-fg-muted` | `color-border-default` | `icon-decision-info` | 中性 |

> 注：`decision-warning` 与 `decision-high` 同色但边框粗细不同（high = 2px，warning = 1px）。

### 4.6 主题策略

**双主题语义对齐**：

- Light / Dark 是同一组 semantic 代币的两个解析值；
- 状态视觉权重、布局、文本字号、动效时长在两主题下完全一致；
- 主题切换不触发布局重排、不引发闪烁；通过 CSS Variables 或 Tailwind dark variant 切换。

**跟随系统**：

- 默认跟随 `prefers-color-scheme`；
- 用户可在偏好（`web-agent-office.md` §5.5）覆盖为 `light` / `dark` / `system`；
- 切换是覆盖语义不变。

**主题覆盖原则**：

| Token 类 | Light | Dark |
|---|---|---|
| `*-bg` | 浅色背景 | 深色背景 |
| `*-fg` | 深色前景 | 浅色前景 |
| `*-border` | 浅灰 | 深灰 |
| 状态 hue（sky/amber/red/emerald） | 100/500 组合 | 800/300 组合 |

### 4.7 可访问性

#### 4.7.1 对比度

| 组合 | 最低对比度 | 验证 |
|---|---|---|
| 普通正文（`fg-default` / `bg-canvas`） | ≥ 4.5:1（WCAG AA） | light: 17.6:1 ✓ / dark: 16.8:1 ✓ |
| 次要文本（`fg-muted` / `bg-canvas`） | ≥ 4.5:1 | light: 7.2:1 ✓ / dark: 7.0:1 ✓ |
| 大字号（≥ 18px / 600+） | ≥ 3:1 | 全部状态满足 |
| 状态色 fg / bg | ≥ 4.5:1 | `amber-700`/`amber-100`: 6.4:1 ✓；`sky-700`/`sky-100`: 7.3:1 ✓；`red-700`/`red-100`: 5.9:1 ✓ |
| `quarantined`（白底红底） | ≥ 4.5:1 | 5.4:1 ✓ |

实现阶段必须用对比度工具（axe / Lighthouse）自动校验全部状态-主题组合。

#### 4.7.2 色盲安全

- 红绿轴不区分主信号（决策 critical 唯一用红）；
- 状态识别主信号是**图标 + 文本标签 + 边框权重**，颜色仅作强化（`web-agent-office.md` §6.1）；
- 在 protanopia / deuteranopia / tritanopia 模拟下，五个身份色可由 hue 差 + 明度差保持区分。

#### 4.7.3 颜色不作为唯一信号

任何状态 / 严重度 / 角色都必须同时具备：

1. 颜色；
2. 图标（§6）；
3. 文本标签（卡片右上角 / 决策项头部）。

缺失任一项视为违反 `web-agent-office.md` §6.1 与 §11.1。

## 5. 排版

### 5.1 字号与行高

> 基准字号 16px。所有 scale 基于 1.125（minor second）或 1.2（minor third）；本文选 1.2 以提高正文可读性。

| Token | px / line-height | 用途 |
|---|---|---|
| `typography-display` | 28 / 1.2 | 仅用于模态标题、空状态主标题 |
| `typography-h1` | 24 / 1.25 | 顶部注意力带 / 决策收件箱头部 |
| `typography-h2` | 20 / 1.3 | 工位卡片标题、侧栏面板标题 |
| `typography-h3` | 18 / 1.4 | 决策项标题、详情面板分组 |
| `typography-body` | 16 / 1.5 | 正文 / 工位卡片正文 |
| `typography-body-sm` | 14 / 1.5 | 次要正文、说明文本 |
| `typography-caption` | 12 / 1.4 | 元信息、时间戳、ID |
| `typography-mono` | 14 / 1.5 (monospace) | actor_id / sequence / 错误码 |

行高全部 ≥ 1.4，避免密集文本。`caption` 用 `1.4` 即可，但禁止低于 1.3。

### 5.2 字重

| Token | weight | 用途 |
|---|---|---|
| `typography-weight-regular` | 400 | 正文 |
| `typography-weight-medium` | 500 | 卡片标题、决策项标题 |
| `typography-weight-semibold` | 600 | 模态标题、空状态、强调 |
| `typography-weight-bold` | 700 | 仅 `quarantined` 徽标 |

**约束**：UI 不使用 `<100` 字重（细体在低 DPI 屏幕易糊）。`bold` 仅用于一个高权重场景，避免权重通胀。

### 5.3 字体栈

```text
typography-family-sans:
  ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont,
  "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
  sans-serif

typography-family-mono:
  ui-monospace, "SF Mono", Menlo, Monaco, Consolas,
  "Liberation Mono", "Courier New", monospace
```

**本地优先约束**（`architecture.md` §11、NFR-03）：

- 禁止引入 webfont（会引入 CDN 依赖、隐私风险）；
- `PingFang SC` / `Microsoft YaHei` 处理中文；
- 系统默认 UI 字体优先；首期不嵌入任何外部字体；
- 后续若需统一品牌字体，引入"本地字体文件 + font-display: swap"，仍遵守 local-first。

### 5.4 因果链文本模板

按 `web-agent-office.md` §6.3，工位卡片"最近活动"用一句话表达：**谁 / 做了什么 / 为什么 / 接下来**。

模板：

```text
{name} {verb} 了 {object}（{requirement_ref}），下一步 {next_action}。
```

模板示例：

- ✅ `pm-1 完成了需求 R-12 的澄清草案，下一步等你确认验收条件。`
- ✅ `dev-2 在实现任务 #456（需求 R-10 / 后端鉴权），下一步等你审阅 PR。`
- ✅ `qa-1 启动了任务 #461 的回归测试，预计 8 分钟完成。`
- ❌ `更新于 14:23`
- ❌ `agent heartbeat`
- ❌ `任务进度 +1`

反例在 §6.3 已经列出，此处不再重复。补充约束：

- 单条 ≤ 60 字；超长截断时优先保留 "谁 / 为什么 / 接下来"；
- ID 用等宽字体（`typography-mono`）但不染色；
- 时间戳用相对时间（"3 分钟前"）+ 悬停显示绝对时间。

## 6. 图标

### 6.1 风格

| 属性 | 值 | 备注 |
|---|---|---|
| 库 | **Phosphor（Regular）或 Lucide** | 两者均为 1.5-2px 描边，圆角端点，简洁；任选其一即可，不混用 |
| 笔触 | 1.5px（16px 尺寸）、2px（24px+） | 一致性 |
| 端点 | `round` | 与 slate 中性色协调 |
| 风格 | `regular`（默认）/ `fill`（选中态） | 不引入第三种风格 |
| 尺寸 | 16 / 20 / 24 / 32 px | 仅这四个尺寸 |
| 色彩 | `currentColor` | 由父元素颜色驱动 |

**约束**：

- 不使用拟人化图标（人脸、表情、emoji 角色）；
- 不使用 emoji 作为状态图标（emoji 颜色不受主题控制，违反 §4.6 主题策略）；
- 状态图标必须独立成库，不依赖品牌色板。

### 6.2 Actor 状态图标

| 状态 | 图标名 | 含义 |
|---|---|---|
| `ready` / `created` | `icon-status-idle` | 空心圆 + 中心点 |
| `running` | `icon-status-running` | 顺时针箭头（循环）+ 进度弧（可选） |
| `paused`（用户） | `icon-status-paused-user` | 双竖线 |
| `paused`（系统） | `icon-status-paused-system` | 双竖线 + 警示边角 |
| `failed` | `icon-status-failed` | 三角警告 |
| `quarantined` | `icon-status-quarantined` | 锁形 + 斜杠（隔离） |
| `restarting` | `icon-status-restarting` | 顺时针箭头 + 闪烁 |
| `terminated` | `icon-status-terminated` | 空心方块 |

每个图标必须有文本标签伴随（§4.7.3）。

### 6.3 角色图标

| 角色 | 图标名 | 含义 |
|---|---|---|
| `product_manager` | `icon-role-pm` | 望远镜 / 罗盘（与"司南"命名呼应） |
| `designer` | `icon-role-designer` | 调色板 / 笔刷 |
| `development_engineer` | `icon-role-dev` | 终端 / `</>` |
| `qa_engineer` | `icon-role-qa` | 盾牌 / 检查清单 |
| `devops_engineer` | `icon-role-devops` | 齿轮 / 服务器 |

角色图标与状态图标尺寸一致；并列时角色图标在左、状态图标在右。

### 6.4 决策 / 动作图标

| 用途 | 图标名 |
|---|---|
| 决策项入口 | `icon-decision-inbox` |
| `decision-critical` | `icon-decision-critical`（紧急圆点） |
| `decision-high` | `icon-decision-high`（向上箭头） |
| `decision-medium` | `icon-decision-medium`（横线） |
| `decision-warning` | `icon-decision-warning`（时钟） |
| `decision-info` | `icon-decision-info`（小写 i） |
| 确认 / 批准 | `icon-action-confirm` |
| 驳回 | `icon-action-reject` |
| 暂停 | `icon-action-pause` |
| 恢复 | `icon-action-resume` |
| 隔离 | `icon-action-quarantine` |
| 终止 | `icon-action-terminate` |
| 查看来源（飞书链接） | `icon-source-feishu` |
| 查看来源（需求） | `icon-source-requirement` |

## 7. 动效

### 7.1 时长代币

| Token | 时长 | 用途 |
|---|---|---|
| `motion-duration-instant` | 0ms | 状态文本更新、对比度切换 |
| `motion-duration-fast` | 120ms | 悬停反馈、按钮按下、tooltip 显隐 |
| `motion-duration-base` | 200ms | 卡片内细节过渡（折叠、徽标进入） |
| `motion-duration-slow` | 300ms | **状态机转移（上限）**、工位跨区域滑动 |
| `motion-duration-deliberate` | 500ms | 仅首次引导动画；之后不再使用 |

**硬约束**：任何状态变化触发的动效 ≤ 300ms（`web-agent-office.md` §6.2）。慢于 300ms 会被用户感知为"卡"。

### 7.2 缓动函数

| Token | cubic-bezier | 用途 |
|---|---|---|
| `motion-ease-out` | `(0.2, 0.8, 0.2, 1)` | 进入（卡片出现、模态打开） |
| `motion-ease-in` | `(0.4, 0, 1, 1)` | 离开（卡片消失、模态关闭） |
| `motion-ease-in-out` | `(0.4, 0, 0.2, 1)` | 原地变化（颜色、字号） |
| `motion-ease-linear` | `linear` | 进度条、旋转图标 |

不使用 `cubic-bezier(0, 0, 1, 1)`（过冲感会让状态变化显得"跳跃"）。

### 7.3 状态转移动画

按 `web-agent-office.md` §5.3 的"状态变化不瞬移"：

| 转移 | 动画 | 时长 | 缓动 |
|---|---|---|---|
| `ready` → `running` | 工位滑入"正在工作"区域；状态色淡入 | 300ms | `ease-out` |
| `running` → `ready` | 工位滑回"待命中"；状态色淡出 | 300ms | `ease-in` |
| `ready`/`running` → `paused`（系统） | 工位滑入"需介入"；amber 边框脉冲一次 | 300ms + 200ms 脉冲 | `ease-out` |
| 任意 → `quarantined` | 工位移到"需介入"顶部；实心红背景脉冲 2 次（强提示） | 300ms 移动 + 200ms × 2 脉冲 | `ease-out` + 警示缓动 |
| `quarantined` → `ready`（人工恢复） | 反向；脉冲停止 | 300ms | `ease-out` |
| `restarting` | 工位在原区域淡入"重启中"图标；状态文本替换 | 200ms | `ease-in-out` |

**禁止**：

- 工位弹跳 / 旋转 / 闪烁持续超过 600ms；
- `quarantined` 之外的状态使用红色脉冲；
- 任何用 CSS `animation-iteration-count: infinite` 的运动图标（违反 §3.2 "动画可关闭"）。

### 7.4 收件箱更新动画

按 `web-agent-office.md` §7：

| 场景 | 动画 |
|---|---|
| 新决策项进入 | 顶部插入；200ms 高度 + 透明度淡入 |
| 决策项解决 | 模态关闭后，对应行折叠 200ms |
| 排序变化 | 整列 FLIP 重排，每项 300ms `ease-in-out` |
| 搁置分区折叠 | 高度 + 透明度 200ms |
| 排序变化原因显示 | tooltip 120ms `ease-out` |

### 7.5 prefers-reduced-motion 行为

按 `web-agent-office.md` §6.2 与 §11.1：

| 状态 | 默认行为 | 用户在偏好中关闭动画后 |
|---|---|---|
| `prefers-reduced-motion: reduce` | 同下 | — |
| `prefers-reduced-motion: no-preference` | 正常 | 用户偏好 > 媒体查询 |

**关闭动画后的行为**：

- 状态变化：瞬时切换（0ms），不滑动、不脉冲；
- 收件箱排序变化：瞬时重排；
- 模态：瞬时显示/隐藏；
- 进度条：仍前进（不属于装饰动画，是状态指示）；
- 必要过渡（如避免闪烁）保留 ≤ 80ms 的微淡入。

**判定规则**：实现必须同时支持 `prefers-reduced-motion` 媒体查询与 `preferences.animations` 用户偏好。两者取更严格的（即若用户偏好开启动画但系统要求减少，仍按减少执行；反之亦然）。这保证无障碍优先于装饰（`web-agent-office.md` §11.1）。

## 8. 间距与栅格

### 8.1 间距

> 4px 基础单位。所有 spacing token 是 4 的倍数。

| Token | px | 用途 |
|---|---|---|
| `space-1` | 4 | 图标-文本内联间距 |
| `space-2` | 8 | 卡片内元素间距 |
| `space-3` | 12 | 列表项垂直间距 |
| `space-4` | 16 | 卡片内边距（最小） |
| `space-6` | 24 | 卡片之间、面板内边距 |
| `space-8` | 32 | 大区块间距 |
| `space-12` | 48 | 模态内边距 |
| `space-16` | 64 | 罕见，仅顶部注意力带留白 |

**不允许**：非 4 倍数间距（如 5px、7px、11px）。这会让视觉密度难以预测。

### 8.2 栅格

- 主区域栅格：12 列；
- 工位卡片最小宽度：240px，最大宽度：320px；
- 卡片间距：`space-4`（16px）；
- 顶部注意力带高度：`space-12 + space-6 = 72px`（含内边距）；
- 模态最大宽度：`space-16 × 8 = 512px`（决策详情）；`space-16 × 12 = 768px`（actor 详情）；
- 窄屏（< 768px）退化为单列堆叠，但工位卡片宽度不变（240-320px），左右留白。

### 8.3 圆角

| Token | px | 用途 |
|---|---|---|
| `radius-sm` | 4 | 标签、徽标 |
| `radius-md` | 6 | 按钮、输入框 |
| `radius-lg` | 8 | 卡片 |
| `radius-xl` | 12 | 模态、抽屉 |
| `radius-full` | 9999 | 头像、圆形徽标 |

不引入圆角 ≥ 16px（大圆角会让卡片显得"软"，违反 §2 "不抢戏"）。

## 9. 边框与阴影

### 9.1 边框

| 用途 | 粗细 | 颜色 |
|---|---|---|
| 卡片默认 | 1px | `color-border-default` |
| 卡片显著（failed / paused-system） | 2px | `color-border-warning` |
| `quarantined` | 2px | `color-border-danger` |
| 选中态 | 2px | `palette-<role>-500` |
| 输入框聚焦 | 2px | `color-border-info`（sky-500） |

**约束**：

- 边框权重是状态权重的二级信号（仅次于图标）；
- 禁止使用 3px 以上边框（大边框占视觉空间，违反 §2）。

### 9.2 阴影

| Token | 用法 |
|---|---|
| `shadow-sm` | 卡片悬停 |
| `shadow-md` | 模态、抽屉 |
| `shadow-lg` | popover、tooltip |
| `shadow-xl` | 极少使用 |

阴影仅用于**深度层级**（平面 + 浮层），不用于状态提示。状态用边框 + 图标 + 颜色表达。

**暗色主题阴影调整**：暗色主题下阴影效果弱化（黑色叠加黑色），需要把阴影改为 `box-shadow: 0 0 0 1px <border-color>`（边缘高亮）补充深度（`web-agent-office.md` §4.6 主题策略）。

## 10. 不做事项

- **不做渐变色背景**：`quarantined` 是实心纯色，不是渐变（避免装饰性）；
- **不做 box-shadow 当作状态信号**：状态永远靠边框 + 图标 + 颜色；
- **不做毛玻璃 / blur 背景**：本地渲染性能成本高，与 local-first 冲突；
- **不做 emoji 状态图标**：颜色不受主题控制；
- **不做 webfont 加载**：本地优先 + 性能（NFR-06）；
- **不做非 4 倍数间距**；
- **不做动画角色 / 拟人化图标**：违反 `web-agent-office.md` §3.2；
- **不做主题差异化的状态语义**：明暗下状态权重、边框粗细、字号保持一致；
- **不做动态主题生成**：调色板来自 token 表，不运行时计算。

## 11. 验收映射

| 视觉决策 | 主要需求 |
|---|---|
| 状态色 = 阻塞语义函数 | `web-agent-office.md` §6.1、`NFR-02` |
| 红色仅用于 quarantined + 未确认副作用 | `web-agent-office.md` §6.1、`REQ-REC-04` |
| 状态识别靠"颜色 + 图标 + 文本"三重信号 | `web-agent-office.md` §6.1、§11.1 |
| 动画 ≤ 300ms、可完全关闭 | `web-agent-office.md` §6.2、§11.1 |
| WCAG AA 对比度、色盲安全 | `web-agent-office.md` §11.1 |
| 占位调色板（slate 中性 + 标准 hue）可整组替换 | `architecture.md` §11 |
| 角色色不替代状态色 | `web-agent-office.md` §5.3 |
| 决策严重度由治理层计算、UI 仅渲染 | `web-agent-office.md` §7.2、`architecture.md` §5.1 |
| 因果链文本模板（谁/做了什么/为什么/接下来） | `web-agent-office.md` §6.3 |
| 本地优先字体（系统 UI） | `architecture.md` §11、`NFR-03` |
| 边框权重是状态权重的二级信号 | `web-agent-office.md` §6.1 |

## 12. 变更记录

- 2026-09-04 v0.1 初稿。锚定 `web-agent-office.md` v0.2。占位调色板选 slate 中性 + 标准 hue（评审答复，2026-09-04）。