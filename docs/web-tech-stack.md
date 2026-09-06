# Web 技术栈：虚拟 Agent 办公室

> **文档性质**：实现 [`web-agent-office.md`](web-agent-office.md) 与 [`web-visual-language.md`](web-visual-language.md) 的技术选型与集成方案。
> **基线**：[`CLAUDE.md`](../CLAUDE.md)（TS / ESM / strict）、[`web-agent-office.md`](web-agent-office.md) v0.2、[`web-visual-language.md`](web-visual-language.md) v0.3、[`architecture.md`](architecture.md) §11（部署与技术决策边界）。
> **不覆盖**：业务逻辑、UI 组件实现细节、CSS class 命名风格（具体命名在组件层决定）。
> **版本**：v0.1 ｜ **状态**：选型评审中 ｜ **更新**：2026-09-04

## 1. 文档规则

1. 任何技术选型必须回指一个或多个 `REQ-*` / `NFR-*` 锚点，或 `web-agent-office.md` / `web-visual-language.md` 的具体章节；纯便利性偏好不进入基线。
2. 选型不可越界：`web-agent-office.md` §3.3（体验层只写派生视图）+ §8（交互边界）继续生效，框架不改变领域所有权。
3. 替换成本评估：若首期替换某技术，是否会扩散到领域层 / server / sinan-core。扩散到领域层的选型需更高级别评审。
4. local-first 与 NFR-06 性能是底线；任何引入运行时 CDN、动态加载大型库、阻塞主线程的方案被拒绝（除非有反例证明）。
5. 与 [`CLAUDE.md`](../CLAUDE.md) TypeScript 规则严格一致：ESM、`verbatimModuleSyntax`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`strict`、`noUncheckedSideEffectImports`。

## 2. 选型总览

| 层 | 选型 | 理由摘要 |
|---|---|---|
| 框架 | **Svelte 5 + SvelteKit** | 评审答复（2026-09-04）；细粒度响应式契合工位状态高频更新；bundle 小符合 NFR-06 |
| 渲染模式 | SPA（无 SSR） | local-first 单用户；server 已是 sinan-server，web 不需要自渲染 |
| 路由 | SvelteKit 文件路由 | 内置；支持嵌套布局与守卫 |
| 构建 | Vite（SvelteKit 自带） | 唯一合理选择 |
| CSS | **Tailwind v4 + `@theme` directive** | 评审答复（2026-09-04）；token 体系原生支持；CSS Variables 驱动主题 |
| 图标 | Phosphor Regular 静态 SVG | [`web-visual-language.md`](web-visual-language.md) §6.1 |
| 类型共享 | **sinan-core** 包（推荐）/ 或 web 内 mirrors | 选 sinan-core 避免漂移 |
| 实时传输 | **SSE** | HTTP 1.1 兼容；自动重连通过 `EventSource`；sinan-server 已用 HTTP |
| 状态管理 | Svelte 5 runes + 自定义 server-state cache | UI 态用 runes；server 态用 thin cache + SSE merge；不引入 Redux / Zustand / Pinia |
| 类型检查 | TypeScript strict（[`CLAUDE.md`](../CLAUDE.md) 继承） | — |
| 单元测试 | Vitest + happy-dom | 与 Vite 共生态 |
| E2E 测试 | Playwright（P2） | — |
| Lint + Format | **Biome** | 单工具、快、原生 TS 支持 |
| 包管理 | npm workspaces（[`CLAUDE.md`](../CLAUDE.md) 继承） | — |

## 3. 框架与运行时

### 3.1 Svelte 5 + SvelteKit 选型理由

- **细粒度响应式**：工位视图需在 actor 状态变化时只更新相关卡片（`web-agent-office.md` §5.3、§7）。Svelte 5 runes（`$state`、`$derived`、`$effect`）天然契合，不需要 selector / memoization 层。
- **Bundle 体积**：单用户本地应用，首屏加载 ≤ 2s（[`web-visual-language.md`](web-visual-language.md) §11.2）。Svelte 编译到原生 DOM，无 virtual DOM 运行时开销。
- **类型系统**：Svelte 5 与 TypeScript 集成成熟；`$props<T>()` / `$bindable<T>()` 提供编译时类型推断。
- **生态契合**：与 [`architecture.md`](architecture.md) §11 描述的"单进程 / 本地存储 / 受控 agent 子进程 / 浏览器界面"边界吻合；不需要 SSR / 服务端能力。
- **CLAUDE.md 兼容**：ESM、`verbatimModuleSyntax`、`noUncheckedIndexedAccess` 等规则在 Svelte 5 项目中无冲突。

### 3.2 不选 React / Vue / Solid 的取舍（记录在案）

- **React 19**：生态最广，但 virtual DOM 在工位状态高频更新场景下比 Svelte/Solid 重；hooks 心智与 §3.1 的"细粒度更新"目标不一致。
- **Vue 3**：心智模型略轻，但中文社区向的生态与 Sinan 的英文工程惯例（CLAUDE.md）混合度一般；bundle 介于 React 与 Svelte 之间。
- **SolidJS**：技术特性最契合（fine-grained reactivity + JSX），但生态最小，第三方组件库少；首期生产力成本高。

> 选型可替换性：web 与领域层通过稳定 API 边界隔离，未来若需更换框架，只需替换 `apps/sinan-web/`，不动 server / sinan-core。

### 3.3 渲染模式：纯 SPA

- SvelteKit `+layout.ts` 配置 `export const ssr = false; export const prerender = false; export const csr = true;`
- 原因：local-first 单用户应用；server 已经独立运行（sinan-server）；web 仅消费 server 暴露的 API + SSE。
- 不引入 SSR：避免重复实现 server 端的领域逻辑、避免 hydration 不一致。

### 3.4 项目结构

```text
apps/sinan-web/
├── src/
│   ├── routes/              # SvelteKit 文件路由
│   │   ├── +layout.svelte   # 全局布局（顶部注意力带 + 工位视图外壳）
│   │   ├── +layout.ts       # ssr=false, prerender=false
│   │   ├── +page.svelte     # 默认入口 → 重定向到 /office
│   │   └── office/
│   │       └── +page.svelte # 主办公区
│   ├── lib/
│   │   ├── api/             # HTTP 客户端（fetch 封装 + SSE 订阅）
│   │   ├── cache/           # server-state cache（thin 自定义）
│   │   ├── stores/          # Svelte runes 包装（UI 态、偏好）
│   │   ├── components/      # 可复用组件（WorkstationCard、DecisionInbox 等）
│   │   └── tokens/          # 与 visual-language 对齐的常量（仅少数需要 TS 端的）
│   ├── app.css              # Tailwind v4 + @theme 入口
│   └── app.html             # SvelteKit 模板
├── static/
│   └── icons/               # Phosphor Regular 静态 SVG 资源
├── svelte.config.js
├── vite.config.ts
├── tsconfig.json
└── package.json
```

`apps/sinan-web/` 与 `apps/sinan-server/` 同 workspaces；通过 npm workspaces 共享依赖与类型。

## 4. 构建与部署

### 4.1 开发模式

- **Vite dev server**（`apps/sinan-web/` 内）监听 5173（SvelteKit 默认）。
- **`vite.config.ts` 中配置 `server.proxy`**：将 `/api/*` 与 `/events/*` 代理到 `http://localhost:<SINAN_SERVER_PORT>`。
- sinan-server 启动时，server 端 `npm run dev -w sinan-server` 暴露 API + SSE endpoint。
- 两个进程并行运行；用户先用 `npm run dev -w sinan-server` 起 server，再 `npm run dev -w sinan-web` 起 web。

### 4.2 生产模式

- **`npm run build -w sinan-web`** 产出 SvelteKit 静态 bundle（`adapter-static`）。
- **产物由 sinan-server 提供**：server 启动时把 `apps/sinan-web/build/` 作为静态资源服务在 `/` 路径；`/api/*` 走 server 业务路由。
- 单端口（server 端口）；用户在浏览器打开 `http://localhost:<port>` 即看到 office UI + 自动连接同端口的 API。
- 避免双进程；避免跨域。

### 4.3 静态资源版本化

- `vite.config.ts` 中 `build.rollupOptions.output.assetFileNames = '[name]-[hash][extname]'`
- 所有图标 SVG、字体（首期无）、CSS、JS chunk 都带 hash；server 端 cache-control: `immutable, max-age=31536000`
- `index.html` 不缓存（`cache-control: no-cache`），保证 SPA 入口更新及时

## 5. CSS 与 token

### 5.1 Tailwind v4 + `@theme`

Tailwind v4 用 CSS-first 配置；`@theme` 指令定义 design tokens，生成对应的 utility classes 与 CSS Variables。

**入口文件 `src/app.css`**：

```css
@import "tailwindcss";

@theme {
  /* —— 颜色：palette 层 —— */
  --color-slate-50:  #f8fafc;
  --color-slate-100: #f1f5f9;
  /* ... 完整 slate / sky / amber / red / emerald / blue / violet / cyan / lime / orange 阶 ... */

  /* —— 颜色：semantic 层（别名引用 palette） —— */
  --color-bg-canvas:       var(--color-slate-50);
  --color-bg-surface:      #ffffff;
  --color-bg-elevated:     #ffffff;
  --color-fg-default:      var(--color-slate-900);
  --color-fg-muted:        var(--color-slate-600);
  --color-fg-subtle:       var(--color-slate-400);
  --color-border-default:  var(--color-slate-200);
  --color-border-strong:   var(--color-slate-300);

  --color-status-info-bg:       var(--color-sky-100);
  --color-status-info-fg:       var(--color-sky-700);
  --color-status-warning-bg:    var(--color-amber-100);
  --color-status-warning-fg:    var(--color-amber-700);
  --color-status-danger-bg:     var(--color-red-100);
  --color-status-danger-fg:     var(--color-red-700);
  --color-status-danger-bg-solid: var(--color-red-600);
  --color-border-warning:       var(--color-amber-500);
  --color-border-danger:        var(--color-red-700);
  --color-fg-on-danger:         #ffffff;

  /* —— 角色色 —— */
  --color-role-pm:        var(--color-blue-500);
  --color-role-designer:  var(--color-violet-500);
  --color-role-dev:       var(--color-cyan-500);
  --color-role-qa:        var(--color-lime-500);
  --color-role-devops:    var(--color-orange-500);

  /* —— 排版 —— */
  --font-sans: ui-sans-serif, system-ui, /* ... 完整栈 ... */;
  --font-mono: ui-monospace, /* ... 完整栈 ... */;

  /* —— 间距 —— */
  --spacing: 4px;  /* base unit */

  /* —— 动效 —— */
  --ease-out:     cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-in:      cubic-bezier(0.4, 0, 1, 1);
  --ease-in-out:  cubic-bezier(0.4, 0, 0.2, 1);

  /* —— 圆角 / 阴影 —— */
  --radius-sm: 0.25rem;
  --radius-md: 0.375rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --color-bg-canvas:       var(--color-slate-950);
    --color-bg-surface:      var(--color-slate-900);
    --color-bg-elevated:     var(--color-slate-800);
    --color-fg-default:      var(--color-slate-100);
    --color-fg-muted:        var(--color-slate-400);
    --color-fg-subtle:       var(--color-slate-500);
    --color-border-default:  var(--color-slate-800);
    --color-border-strong:   var(--color-slate-700);

    --color-status-info-bg:    var(--color-sky-900);
    --color-status-info-fg:    var(--color-sky-300);
    --color-status-warning-bg: var(--color-amber-900);
    --color-status-warning-fg: var(--color-amber-300);
    --color-status-danger-bg-solid: var(--color-red-800);

    /* ... 其余 dark 覆盖 ... */
  }
}

[data-theme="dark"] {
  /* 强制 dark 模式，覆盖系统偏好 */
  /* 与 media 查询块内容相同 */
}
```

### 5.2 与 [`web-visual-language.md`](web-visual-language.md) 的对齐

- `web-visual-language.md` §4.2 占位调色板的所有 token 必须出现在 `@theme` 中（不允许视觉规范 vs CSS 实装漂移）。
- §5 字号 / §7 时长 / §8 间距同样按 visual 规范逐项落入 `@theme`。
- 不在 `@theme` 之外另写 CSS token；单一来源。

### 5.3 组件 class 风格

业务组件优先使用语义 utility：

```svelte
<div class="bg-bg-surface text-fg-default border border-border-default rounded-lg p-4">
  <span class="text-status-info-fg">{actorName}</span>
</div>
```

状态/角色色不允许硬编码（`bg-sky-100` 不允许；必须 `bg-status-info-bg`）。

## 6. 状态管理

### 6.1 Svelte 5 runes for UI state

UI 本地态（模态开合、当前焦点、悬浮态）用 runes：

```ts
let inboxOpen = $state(false);
let focusedDecisionId = $state<string | null>(null);
```

不引入 Redux / Zustand / Pinia —— 单用户应用 UI 态规模小，runes 直接处理。

### 6.2 server-state cache（thin 自定义）

需求：

- 高频订阅（`actor.state-changed`、`decision.*`、`requirement.*` 等事件）；
- 每个 entity 的最新派生视图（actor view、decision item view）；
- 主动重新拉取能力（失联重连后，`web-agent-office.md` §9.2）。

实现方式（推荐，**不引入外部库**）：

```ts
// src/lib/cache/server-state.ts
export class ServerStateCache<T> {
  private map = $state(new Map<EntityId, T>());

  get(id: EntityId): T | undefined { return this.map.get(id); }
  list(filter?: Filter): T[] { /* 派生 */ }

  upsert(id: EntityId, value: T) { this.map.set(id, value); }
  remove(id: EntityId) { this.map.delete(id); }
  replaceAll(items: T[]) { /* 全量替换 */ }
}
```

封装三个实例：`actorCache`、`decisionCache`、`requirementCache`。

**理由**：

- svelte-query / RTK Query 的特性对单用户本地应用是过度工程；
- 我们需要的只是"按 id 存 / 派生 / 全量替换"三件事，加 SSE merge（§7.3）；
- 派生视图（`list(filter)`）用 `$derived` 直接计算，不在 cache 中冗余存储。

### 6.3 持久化用户偏好

按 [`web-agent-office.md`](web-agent-office.md) §5.5，`workstation.position`、`workstation.sort` 等由 server 持久化。web 端：

- 启动时主动拉取偏好（GET `/api/preferences`）；
- 改变时 PATCH `/api/preferences`；
- SSE 订阅 `preference.changed` 事件（多设备同步）。

## 7. 实时数据

### 7.1 选 SSE 而非 WebSocket

| 维度 | SSE | WebSocket |
|---|---|---|
| 协议 | HTTP/1.1 长连接 | 独立升级协议 |
| 自动重连 | `EventSource` 内置 | 需手写 |
| 鉴权 | 标准 HTTP 头 | 需自定义握手 |
| 双向 | 仅服务端 → 客户端 | 双向 |
| 浏览器 API | 原生 | 原生 |
| 代理友好 | 是 | 视代理而定 |

**SSE 足够**：web 不需要反向推消息（命令通过 POST 发出，参见 [`web-agent-office.md`](web-agent-office.md) §8.1）。状态/事件单向流与 SSE 模型完美匹配。

### 7.2 SSE 端点协议

- **URL**：`GET /events`，返回 `text/event-stream`；
- **客户端**：原生 `EventSource('/events')`；
- **事件帧**：

  ```text
  event: actor.state-changed
  id: <sequence>
  data: { "actorId": "...", "from": {...}, "to": {...}, "at": ... }

  event: decision.created
  id: <sequence>
  data: { ... }

  ...
  ```

- **Last-Event-ID**：浏览器自动重连时携带；server 据此做断点续传（`REQ-REC-05`、[`actor-runtime.md`](actor-runtime.md) §9）。

### 7.3 与 cache 的集成

```ts
// src/lib/api/event-stream.ts
const events = new EventSource('/events');

events.addEventListener('actor.state-changed', (e) => {
  const evt = JSON.parse(e.data);
  actorCache.upsert(evt.actorId, deriveView(evt));
});

events.addEventListener('decision.created', (e) => {
  const evt = JSON.parse(e.data);
  decisionCache.upsert(evt.decisionId, deriveView(evt));
});
```

事件流断开重连后，主动拉取 `/api/actors`、`/api/decisions` 全量重建 cache（[`web-agent-office.md`](web-agent-office.md) §9.2 "领域事实是权威"）。

### 7.4 不可丢失信号

[`web-agent-office.md`](web-agent-office.md) §9.3 要求 `quarantined` 与"未确认外部副作用"决策项必须即时呈现：

- SSE 已具备事件即时性，无需额外通道；
- 实现层在 cache 端确保事件触发 UI 同步（runes 自动）；
- 若 server 实现选择独立通道（如单独的"critical stream"），web 端订阅多个 EventSource 即可（不互斥）。

## 8. 类型与共享

### 8.1 通过 sinan-core 共享类型（推荐）

`packages/sinan-core/` 当前是 scaffold-only（[`CLAUDE.md`](../CLAUDE.md)）。建议**立刻**填充：

```text
packages/sinan-core/src/
├── actor/
│   ├── types.ts        # ActorRole, ActorConfig, ActorState, ActorEvent
│   ├── commands.ts     # ActorCommand 联合
│   └── index.ts
├── api/
│   ├── endpoints.ts    # 类型化 HTTP 端点契约
│   └── index.ts
└── index.ts
```

迁移 actor-runtime.md 中的类型（`ActorRole`、`ActorConfig`、`ActorState`、`ActorEvent`、`ActorCommand`、`ActorView` 等）到 `sinan-core/src/actor/types.ts`。

**收益**：

- web 与 server 共享类型，零漂移；
- 类型是单文件 single source of truth（避免 web 内部 mirrors）；
- 未来命令行 / IDE 插件等 client 也能复用。

**约束**：

- sinan-core **不允许** 引入运行时依赖（仅 type-level import）；
- 类型必须是纯类型，不含副作用或具体实现；
- 这与 [`actor-runtime.md`](actor-runtime.md) §3.1 "ActorConfig 创建后只读" 一致。

### 8.2 备选：web 内部 mirror

若 sinan-core 同步延迟，临时方案：

```ts
// apps/sinan-web/src/lib/api/types.ts
import type { ActorRole, ActorConfig, ActorState, ActorEvent, ActorCommand } from 'sinan-core/actor';
```

通过 workspace 依赖而非 copy；这是过渡方案，目标是迁到 §8.1。

### 8.3 不推荐：从 server 源码生成

理论上可用 ts-morph 从 `apps/sinan-server/src/` 生成类型。**否决理由**：

- 增加构建复杂度；
- 类型应"按域"暴露，而非"按源码目录"暴露（[`architecture.md`](architecture.md) §6.3 模块所有权）；
- sinan-core 的存在已经解决了这个需求。

## 9. 图标

### 9.1 静态 SVG 资源

[`web-visual-language.md`](web-visual-language.md) §6.1 决定：Phosphor Regular 静态 SVG，每图标独立文件。

**资源结构**：

```text
apps/sinan-web/static/icons/
├── status/
│   ├── idle.svg
│   ├── running.svg
│   ├── paused-user.svg
│   ├── paused-system.svg
│   ├── failed.svg
│   ├── quarantined.svg
│   ├── restarting.svg
│   └── terminated.svg
├── role/
│   ├── pm.svg
│   ├── designer.svg
│   ├── dev.svg
│   ├── qa.svg
│   └── devops.svg
├── decision/
│   ├── inbox.svg
│   ├── critical.svg
│   ├── high.svg
│   ├── medium.svg
│   ├── warning.svg
│   └── info.svg
└── action/
    ├── confirm.svg
    ├── reject.svg
    ├── pause.svg
    ├── resume.svg
    ├── quarantine.svg
    └── terminate.svg
```

约 25 个图标；从 Phosphor Regular 集导出，去掉 fill、内部 style 等，统一 `stroke="currentColor"`、`stroke-width="1.5"`、`stroke-linecap="round"`。

### 9.2 不引入 Phosphor Svelte 组件库

- `@phosphor-icons/svelte` 提供运行时组件；
- 首期我们需要的图标数量稳定（25 个左右），静态资源更可控、更小；
- 不引入运行时库 = 减少依赖、减少首期学习成本。

### 9.3 引用方式

```svelte
<!-- WorkstationCard.svelte -->
<svg viewBox="0 0 24 24" width="16" height="16" class="text-role-pm">
  <use href="/icons/role/pm.svg#root" />
</svg>
```

或用 Vite `import.meta.url` 引用（生产环境带 hash）：

```ts
import pmIcon from '$lib/icons/role/pm.svg?raw';
```

实现层决定；规范层不锁定。

## 10. 测试与质量

### 10.1 单元测试（Vitest + happy-dom）

- **范围**：cache 逻辑、runes 派生、reducer 逻辑、token 解析、事件 merge；
- **DOM 相关**：用 happy-dom 而非 jsdom（更快、与 Vite 更兼容）；
- **运行**：`npm run test -w sinan-web`（Vitest 默认配置）；
- **必须 100% 覆盖**：`src/lib/cache/`、`src/lib/api/event-stream.ts` 的事件 merge 逻辑。

### 10.2 E2E 测试（Playwright，P2）

- **首期不强制**：单用户本地应用，E2E 价值低；
- P2 纳入：覆盖完整 office 流程（打开 → 看到工位 → 收件箱交互 → 偏好持久化）。

### 10.3 Lint + Format（Biome）

- **单工具**：Biome 同时做 lint + format（替代 ESLint + Prettier）；
- **快**：Rust 实现，单核 < 100ms；
- **TS 原生支持**；
- **配置**：

  ```jsonc
  // biome.json
  {
    "linter": {
      "rules": {
        "recommended": true,
        "suspicious": { "noExplicitAny": "error" },
        "style": { "useImportType": "error" }
      }
    },
    "formatter": {
      "indentStyle": "space",
      "indentWidth": 2
    },
    "javascript": {
      "formatter": { "quoteStyle": "single", "semicolons": "always" }
    }
  }
  ```

- **与 [`CLAUDE.md`](../CLAUDE.md) 一致性**：Biome 的 `useImportType` 与 `verbatimModuleSyntax` 规则对齐。

### 10.4 严格类型检查

- `npm run check -w sinan-web`（SvelteKit 内置 `svelte-check`）；
- CI 阶段必须 0 error / 0 warning。

## 11. 不做事项

- **不引入 SSR**：local-first；server 已独立运行；
- **不引入 PWA / Service Worker**：单用户本地应用，无离线场景；
- **不引入状态机库（XState 等）**：UI 态规模小，runes + 派生足够；
- **不引入图表库**：首期无图表需求（[`web-agent-office.md`](web-agent-office.md) §13 不做全景仪表盘）；
- **不引入 i18n 库**：首期单语中文；预留 `svelte-i18n` 引入位置但不集成；
- **不引入 webfont**：本地优先 + NFR-06（[`web-visual-language.md`](web-visual-language.md) §5.3）；
- **不引入客户端数据库（IndexedDB 等）**：web 端的派生视图不持久化（server 是权威）；用户偏好走 server（[`web-agent-office.md`](web-agent-office.md) §5.5）；
- **不引入运行时配置中心（LaunchDarkly 等）**：单用户应用；
- **不引入 telemetry / analytics**：NFR-07 隐私边界；
- **不引入 CSS-in-JS**：与 Tailwind v4 冲突；运行时开销违反 NFR-06。

## 12. 验收映射

| 选型 | 主要锚点 |
|---|---|
| Svelte 5 细粒度响应式 | [`web-agent-office.md`](web-agent-office.md) §5.3、§7 |
| 纯 SPA + SvelteKit adapter-static | [`web-agent-office.md`](web-agent-office.md) §3.3、`architecture.md` §11 |
| Tailwind v4 `@theme` 与 token 对齐 | [`web-visual-language.md`](web-visual-language.md) §3、§4 |
| SSE 而非 WebSocket | [`web-agent-office.md`](web-agent-office.md) §9、`NFR-06` |
| 自定义 thin cache（不引入 svelte-query） | 单用户规模，`NFR-06` |
| sinan-core 共享类型 | [`CLAUDE.md`](../CLAUDE.md) "shared library workspace"、避免漂移 |
| Phosphor Regular 静态 SVG | [`web-visual-language.md`](web-visual-language.md) §6.1 |
| Biome 替代 ESLint+Prettier | `NFR-06`（性能）、单工具简化 |
| 不引入 webfont / PWA / IndexedDB | `NFR-03`、`NFR-06`、`NFR-07` |
| server 同时托管 API + 静态资源 | `architecture.md` §11、"单进程"部署形态 |

## 13. 依赖基线（首期）

> 仅列**新增**依赖；sinan-core 等继承 workspace。

| 依赖 | 用途 |
|---|---|
| `svelte` ^5 | 框架 |
| `@sveltejs/kit` | 路由 / 构建 |
| `@sveltejs/adapter-static` | 静态导出 |
| `@sveltejs/vite-plugin-svelte` | Vite 插件 |
| `vite` ^5 | 构建 |
| `typescript` ^5 | 类型 |
| `tailwindcss` ^4 | CSS |
| `vitest` | 单元测试 |
| `happy-dom` | 测试 DOM |
| `@biomejs/biome` | lint + format |
| `svelte-check` | 类型检查 |

**禁止**：

- 任何运行时依赖通过 CDN 加载；
- 任何与 NFR-07 隐私边界冲突的依赖（请阅读依赖隐私政策）；
- 任何与 [`CLAUDE.md`](../CLAUDE.md) 类型规则冲突的依赖（无类型定义、要求关闭 strict 等）。

## 14. 变更记录

- 2026-09-04 v0.1 初稿。锚定 [`web-agent-office.md`](web-agent-office.md) v0.2、[`web-visual-language.md`](web-visual-language.md) v0.3。选型决定：Svelte 5 + SvelteKit、Tailwind v4 + `@theme`、SSE、Phosphor Regular 静态 SVG、Biome、Vitest、sinan-core 共享类型（评审答复，2026-09-04）。