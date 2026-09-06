# Server HTTP API：Web 与外部客户端契约

> **文档性质**：sinan-server 向 web（[`web-agent-office.md`](web-agent-office.md)）及其它客户端暴露的 HTTP / SSE 契约。
> **基线**：[`architecture.md`](architecture.md) §11（部署与技术决策边界）、[`actor-runtime.md`](actor-runtime.md)（actor 数据形态与命令）、[`web-agent-office.md`](web-agent-office.md) §5.5 / §7 / §9（用户偏好、决策项、实时数据）、[`web-tech-stack.md`](web-tech-stack.md) §7（实时数据）。
> **不覆盖**：内部领域逻辑（定义在 `actor-runtime.md` / 后续模块设计）、持久化 schema（定义在 [`actor-schema.sql`](actor-schema.sql)）、UI 行为（定义在 [`web-agent-office.md`](web-agent-office.md)）。
> **版本**：v0.1 ｜ **状态**：评审中 ｜ **更新**：2026-09-04

## 1. 文档规则

1. 本文档只规定 HTTP / SSE 边界，不重新定义领域语义。任何 endpoint 必须能回指 `actor-runtime.md` / `architecture.md` / `web-agent-office.md` 中的稳定概念。
2. endpoint 设计优先保持与 `ActorCommand` / `ActorEvent` 等已定义的领域联合一对一映射；不允许出现"语义相同但命名不同"的双重表述。
3. 所有错误响应必须携带 machine-readable `code`（[`actor-runtime.md`](actor-runtime.md) §9），不允许只返回 HTTP 状态码。
4. 任何写操作必须遵守 [`architecture.md`](architecture.md) §6.3 模块所有权：只能调用责任模块暴露的接口，不允许 web 端绕过。
5. 不引入认证 / 多租户 / 速率限制（[`CLAUDE.md`](../CLAUDE.md) §NFR-09 单用户边界）。Host 限制（仅 `127.0.0.1`）由 [`architecture.md`](architecture.md) §11 约束，本文档不重复。
6. 不规定 HTTP 框架、路由库选型（实现阶段决定）。

## 2. 设计目标

| 维度 | 定义 | 主要锚点 |
|---|---|---|
| **可读** | URL + 方法 + JSON 形状能自解释；不需要额外文档也能调用 | `NFR-02` |
| **可演进** | 新增 endpoint 不破坏现有调用方；删除需走 deprecation | `architecture.md` §11 |
| **不阻塞** | 长任务（agent 执行、检索）通过 SSE 推流，不让 HTTP 调用阻塞 | `NFR-06`、`web-agent-office.md` §9 |
| **可恢复** | SSE 断线后能用 `Last-Event-ID` 续传 | `REQ-REC-05` |
| **可解释** | 错误码能直接对应到 `actor-runtime.md` §9 错误表 | `NFR-02`、`web-agent-office.md` §8.3 |

## 3. 总览

### 3.1 URL 约定

- **前缀**：`/api/*`（业务 REST）、`/events`（SSE 流）。
- **命名**：复数名词（`/actors`、`/decisions`、`/requirements`），避免动词。
- **嵌套**：单层嵌套（`/actors/:id/events`），不深于 2 层；更深语义走 query 参数。
- **大小写**：URL 全小写、kebab-case；JSON 字段 camelCase（与现有 server 类型对齐）。

### 3.2 内容协商

| 维度 | 默认 | 备注 |
|---|---|---|
| Request body | `Content-Type: application/json` | 所有写操作必须 |
| Response body | `Content-Type: application/json; charset=utf-8` | 所有业务 endpoint |
| SSE response | `Content-Type: text/event-stream` | 固定 |
| 字符集 | UTF-8 | 全部 |
| 时间戳 | `number`（Unix 毫秒） | 与 [`actor-runtime.md`](actor-runtime.md) §3.1 `Timestamp` 一致 |
| ID 风格 | UUID v4 | 与现有 server 代码一致（`randomUUID`） |

### 3.3 错误响应统一格式

所有非 2xx 响应 body：

```json
{
  "code": "actor-not-found",
  "message": "Actor abc-123 does not exist",
  "details": { "actorId": "abc-123" } | null
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | string | machine-readable 错误码，来自 [`actor-runtime.md`](actor-runtime.md) §9 / 本文档 §10 |
| `message` | string | 人类可读原因；本地化推迟到 v0.2 |
| `details` | object \| null | 错误上下文（如缺失字段名、actorId 等） |

HTTP 状态码语义：

| 状态码 | 含义 |
|---|---|
| 200 / 204 | 成功 |
| 400 | 请求体字段校验失败（`code: invalid-input`） |
| 404 | 资源不存在（`code: actor-not-found` 等） |
| 409 | 状态机不允许（`code: invalid-state-transition`） |
| 422 | 业务规则拒绝（`code: policy-violation` 等） |
| 500 | 内部错误（`code: internal-error`） |
| 503 | 持久化层不可用（`code: persistence-unavailable`） |

### 3.4 写操作幂等性

- **`POST /api/actors`**：接受可选 `Idempotency-Key` 请求头；同一 key 在 24h 内重复请求返回首次响应（避免快速双击创建重复 actor）。
- **`POST /api/actors/:id/commands`**：命令发送本身已幂等（manager 接受命令即返回，不重复执行）—— 但命令内部副作用（如 restart）由领域层负责。
- **`PATCH /api/preferences/:key`**：天然幂等（last-write-wins by `key`）。
- **`POST /api/decisions/:id/resolve`**：决策解决后再次调用返回 `code: decision-already-resolved`（409），不静默成功。

## 4. Actor API

> 锚定 [`actor-runtime.md`](actor-runtime.md) §3（数据形态）、§4（状态机）、§5.1（命令）、§6（ActorManager 接口）。

### 4.1 创建

```http
POST /api/actors
Content-Type: application/json
Idempotency-Key: <uuid>  (可选)

{
  "name": "Builder",
  "role": "development_engineer",
  "workspace": "/work/project",
  "tools": ["read", "bash"],
  "promptTemplateRef": "default",
  "limits": { "maxWallClockMs": 3600000 }
}
```

**Response 201**：

```json
{
  "id": "actor-uuid",
  "name": "Builder",
  "role": "development_engineer",
  "workspace": "/work/project",
  "state": { "kind": "ready" },
  "lastEventAt": 1700000000000,
  "policy": { "kind": "on-failure", "maxRetries": 3, "backoffMs": 1000, "jitter": true }
}
```

错误：`invalid-input`（400，字段缺失或 role 不在枚举内）、`policy-violation`（422，工具/限制越界）、`persistence-unavailable`（503）。

### 4.2 列表

```http
GET /api/actors?role=development_engineer&stateKind=running
```

**Response 200**：

```json
{
  "items": [
    {
      "id": "actor-uuid",
      "role": "development_engineer",
      "stateKind": "running",
      "lastEventAt": 1700000000000
    }
  ]
}
```

锚定 `ActorSummary`（[`actor-runtime.md`](actor-runtime.md) §6）。

### 4.3 详情

```http
GET /api/actors/:id
```

**Response 200**：

```json
{
  "id": "actor-uuid",
  "config": { /* 完整 ActorConfig */ },
  "state": { "kind": "running", "taskId": "...", "leaseId": "..." },
  "currentCheckpoint": "ckpt-uuid" | null,
  "lastEventAt": 1700000000000,
  "policy": { ... }
}
```

锚定 `ActorView`（[`actor-runtime.md`](actor-runtime.md) §6）。

错误：`actor-not-found`（404）。

### 4.4 发送命令

```http
POST /api/actors/:id/commands
Content-Type: application/json

{
  "kind": "pause",
  "reason": { "kind": "user-requested" }
}
```

`kind` 必须是 [`actor-runtime.md`](actor-runtime.md) §5.1 `ActorCommand` 联合的成员；其余字段由 `kind` 决定。

**Response 202**：

```json
{
  "accepted": true,
  "commandId": "cmd-uuid",
  "appliedAt": 1700000000000
}
```

> **注意**：**202 Accepted**——命令已被 manager 接受并进入处理链，不保证已生效。实际状态变化通过 SSE 推送（§8）。

错误：`actor-not-found`（404）、`invalid-state-transition`（409，当前状态不允许该命令）、`policy-violation`（422，违反重启策略）。

### 4.5 事件历史

```http
GET /api/actors/:id/events?since=0&limit=20
```

- `since`：起始 `sequence`（per-actor 单调，exclusive）；
- `limit`：默认 20（D-04，[`web-agent-office.md`](web-agent-office.md) §15），上限 200；
- 返回按 `sequence` 升序。

**Response 200**：

```json
{
  "items": [
    {
      "sequence": 1,
      "eventId": "evt-uuid",
      "kind": "state-changed",
      "at": 1700000000000,
      "payload": { /* 完整 ActorEvent 负载 */ }
    }
  ],
  "nextSince": 21
}
```

错误：`actor-not-found`（404）。

## 5. Decision API

> 决策项由决策管理模块创建（[`architecture.md`](architecture.md) §6.1 / §7.4）。本节定义 web 侧的查询与解决接口。
> **状态**：决策领域模型尚未完整设计，本节先定义接口形状；字段语义待 [`decision-management.md`](decision-management.md)（未来文档）补全。

### 5.1 列表

```http
GET /api/decisions?status=open&limit=20
```

- `status`：`open`（默认）| `resolved` | `all`；
- `limit`：默认 20（与收件箱折叠阈值 D-03 对齐）；
- 返回按 `web-agent-office.md` §7.2 排序算法计算后的顺序。

**Response 200**：

```json
{
  "items": [
    {
      "id": "dec-uuid",
      "kind": "requirement-conflict",
      "severity": "decision-critical",
      "title": "需求 R-12 与 R-15 的目标范围冲突",
      "source": { "requirementId": "R-12", "requirementVersion": 3 },
      "blockedTaskCount": 5,
      "createdAt": 1700000000000,
      "options": [
        { "id": "continue-r12", "label": "继续 R-12，暂停 R-15", "impact": { /* */ } },
        { "id": "merge", "label": "合并为新需求 R-16", "impact": { /* */ } }
      ]
    }
  ],
  "foldedCount": 12  // 被折叠到"搁置"分区的项数
}
```

锚定 [`web-agent-office.md`](web-agent-office.md) §7.1 决策项数据来源。

### 5.2 详情

```http
GET /api/decisions/:id
```

**Response 200**：

```json
{
  "id": "dec-uuid",
  "context": { /* 来源、证据、相关任务、相关需求版本 */ },
  "options": [...],
  "blockedTaskCount": 5,
  "externalSideEffectUnknown": false,
  "recommendedOption": "merge",
  "recommendationRationale": "先例 P-042（来源：…）",
  "urgency": { "leaseDeadline": 1700000600000 }
}
```

### 5.3 解决

```http
POST /api/decisions/:id/resolve
Content-Type: application/json

{
  "option": "merge",
  "note": "合并到 R-16，需求 1.5 倍估时"
}
```

**Response 200**：

```json
{
  "resolved": true,
  "impact": {
    "affectedTasks": ["#456", "#460"],
    "affectedRequirements": ["R-12", "R-15"],
    "createdMemoryEntries": ["mem-uuid"]
  },
  "events": ["evt-uuid-1", "evt-uuid-2"]
}
```

锚定 [`web-agent-office.md`](web-agent-office.md) §7.4 "决策动作的影响可见"——此响应即"影响摘要"。

错误：`decision-not-found`（404）、`decision-already-resolved`（409）、`invalid-input`（400，option 不在 options 列表中）。

## 6. Requirement API

> 锚定 [`requirements.md` REQ-INT-04](../requirements.md) §4.1（需求版本化）。

### 6.1 列表

```http
GET /api/requirements?status=active
```

- `status`：`active`（默认，未交付）| `frozen` | `delivered` | `all`。

**Response 200**：

```json
{
  "items": [
    {
      "id": "R-12",
      "title": "导出功能",
      "currentVersion": 3,
      "status": "frozen",
      "createdAt": 1700000000000
    }
  ]
}
```

### 6.2 版本树

```http
GET /api/requirements/:id/versions
```

**Response 200**：

```json
{
  "id": "R-12",
  "versions": [
    { "version": 3, "status": "frozen", "diffFromPrevious": "...", "createdAt": ... },
    { "version": 2, "status": "superseded", "createdAt": ... },
    { "version": 1, "status": "superseded", "createdAt": ... }
  ]
}
```

### 6.3 版本详情

```http
GET /api/requirements/:id/versions/:version
```

**Response 200**：

```json
{
  "id": "R-12",
  "version": 3,
  "goal": "...",
  "why": "...",
  "scope": ["in-scope-1", "in-scope-2"],
  "outOfScope": ["..."],
  "acceptanceConditions": ["ac-1", "ac-2"],
  "sourceIntentId": "intent-uuid",
  "status": "frozen",
  "createdAt": 1700000000000,
  "frozenAt": 1700000010000
}
```

## 7. Preference API

> 锚定 [`web-agent-office.md`](web-agent-office.md) §5.5（用户偏好作为新事实类别）。
> **状态**：用户偏好表 schema（D-01）尚未实现，本节定义 API 形状，待 schema 落地后端实现。

### 7.1 获取当前所有偏好

```http
GET /api/preferences
```

**Response 200**：

```json
{
  "items": [
    { "key": "workstation.position.actor-uuid", "value": { "x": 240, "y": 120 } },
    { "key": "workstation.sort", "value": "state-machine" },
    { "key": "preferences.theme", "value": "system" },
    { "key": "preferences.animations", "value": "system" }
  ]
}
```

### 7.2 修改单条偏好

```http
PATCH /api/preferences/:key
Content-Type: application/json

{ "value": { "x": 360, "y": 80 } }
```

**Response 200**：

```json
{ "ok": true, "key": "workstation.position.actor-uuid", "value": { "x": 360, "y": 80 } }
```

锚定 [`web-agent-office.md`](web-agent-office.md) §5.5——偏好改变走 server 持久化、不进入审计事实链、不触发业务事件（但通过 SSE 推 `preference.changed` 事件以同步多端）。

错误：`invalid-input`（400，key 不在白名单或 value 类型不匹配）。

### 7.3 偏好白名单（首期）

`web-agent-office.md` §5.5 列出的 key 是首期白名单。新增 key 需走 schema 演进。

## 8. SSE 事件协议

### 8.1 端点

```http
GET /events
Accept: text/event-stream
Last-Event-ID: <sequence>  (可选，断线续传)
```

**Response 200**：

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### 8.2 帧格式

```
event: <event-name>
id: <monotonic-sequence>
data: <json-payload>

(blank line)
```

- `event`：事件名（见 §8.3）；
- `id`：全局单调递增序列号（所有事件共用一个序号空间，跨领域共享）；
- `data`：JSON 对象，承载事件负载。

**示例**：

```
event: actor.state-changed
id: 1234
data: {"actorId":"abc-123","from":{"kind":"ready"},"to":{"kind":"running","taskId":"#456","leaseId":"lease-1"},"at":1700000000000,"cause":{"kind":"command","command":"assign"}}

event: decision.created
id: 1235
data: {"decisionId":"dec-uuid","severity":"decision-critical","title":"..."}

```

### 8.3 事件目录（首期）

| 事件名 | 锚定 | 出现条件 |
|---|---|---|
| `actor.state-changed` | [`actor-runtime.md`](actor-runtime.md) §5.2 | 每次 actor 状态机转移 |
| `actor.event` | [`actor-runtime.md`](actor-runtime.md) §5.2 | 通用 actor 事件（progress / log / checkpoint-created / output-recorded / lease-renewed / failed / terminated 等） |
| `decision.created` | [`web-agent-office.md`](web-agent-office.md) §7.1 | 新决策项进入 |
| `decision.updated` | [`web-agent-office.md`](web-agent-office.md) §7.1 | 决策项内容变化（不影响排序字段） |
| `decision.resolved` | [`web-agent-office.md`](web-agent-office.md) §7.4 | 决策已解决 |
| `requirement.created` | [`requirements.md` REQ-INT-03](../requirements.md) | 需求确认后产生新版本 |
| `requirement.updated` | [`requirements.md` REQ-INT-04](../requirements.md) | 需求版本内容变化 |
| `requirement.frozen` | [`architecture.md`](architecture.md) §7.6 | 需求进入冻结窗口 |
| `task.derived` | [`requirements.md` REQ-COL-01](../requirements.md) | 任务从需求派生 |
| `task.progressed` | [`requirements.md` REQ-COL-01](../requirements.md) | 任务进度更新 |
| `task.blocked` | [`requirements.md` REQ-COL-02](../requirements.md) | 任务阻塞 |
| `task.completed` | [`requirements.md` REQ-COL-01](../requirements.md) | 任务完成 |
| `external-result.unknown` | [`requirements.md` REQ-REC-04](../requirements.md) | **未确认的外部副作用**——不可丢失信号（[`web-agent-office.md`](web-agent-office.md) §9.3） |
| `external-result.failed` | [`requirements.md` REQ-REC-02](../requirements.md) | 外部操作明确失败 |
| `preference.changed` | [`web-agent-office.md`](web-agent-office.md) §5.5 | 用户偏好改变（多端同步） |
| `server.recovery` | [`actor-runtime.md`](actor-runtime.md) §8.5 | server 完成启动恢复 |
| `server.shutdown` | 运维信号 | server 进入关闭流程 |

### 8.4 续传与去重

- **续传**：客户端在 `Last-Event-ID` 头携带最后收到的事件 id；server 从该 id+1 开始重放。
- **去重**：事件 id 跨领域单调递增；client 端维护最近 N 个 id（建议 N=1000）做去重。
- **乱序**：不允许乱序；事件按 id 升序推送。

### 8.5 心跳

每 30s server 推送一条注释帧（`:` 开头），防止中间代理超时断开：

```
: keepalive
```

client 视为无害，丢弃。

## 9. 健康检查

```http
GET /api/health
```

**Response 200**：

```json
{
  "status": "ok",
  "since": 1700000000000,
  "version": "0.0.1",
  "actorCount": 5,
  "quarantinedCount": 0
}
```

`status` 取值：

- `ok`：正常运行；
- `recovering`：server 正在执行启动恢复（[`actor-runtime.md`](actor-runtime.md) §8.5）—— web 应避免发起非读操作；
- `degraded`：持久化层报错但读路径仍可用。

错误：500 表示 server 不可用。

## 10. 错误码目录

| `code` | HTTP 状态 | 含义 | 锚定 |
|---|---|---|---|
| `invalid-input` | 400 | 请求体字段缺失或类型错误 | 本文档 |
| `actor-not-found` | 404 | actorId 不存在 | [`actor-runtime.md`](actor-runtime.md) §9 |
| `decision-not-found` | 404 | 决策项不存在 | 本文档 |
| `decision-already-resolved` | 409 | 决策已解决 | 本文档 |
| `requirement-not-found` | 404 | 需求不存在 | 本文档 |
| `invalid-state-transition` | 409 | 当前 actor 状态不允许该命令 | [`actor-runtime.md`](actor-runtime.md) §9 |
| `policy-violation` | 422 | 命令违反重启策略 | [`actor-runtime.md`](actor-runtime.md) §9 |
| `checkpoint-corrupted` | 422 | 快照损坏 | [`actor-runtime.md`](actor-runtime.md) §9 |
| `persistence-unavailable` | 503 | 持久化层不可用 | [`actor-runtime.md`](actor-runtime.md) §9 |
| `lease-expired-during-recovery` | 409 | 恢复时发现 lease 已过期 | [`actor-runtime.md`](actor-runtime.md) §9 |
| `inconsistent-state` | 409 | 配置/事件/状态三者冲突 | [`actor-runtime.md`](actor-runtime.md) §9 |
| `internal-error` | 500 | 未分类内部错误 | 本文档 |

## 11. 不做事项

- **不做认证 / 授权 / 速率限制**：[`CLAUDE.md`](../CLAUDE.md) NFR-09 单用户边界；
- **不做 API 版本号前缀**（`/api/v1/...`）：首期单版本；演进通过 deprecation 头而非 URL 重构；
- **不做 HATEOAS / 超媒体**：本系统 UI 与 API 由同一团队维护，超媒体增加复杂度无收益；
- **不做 GraphQL**：REST + SSE 足够；GraphQL 的 N+1 与缓存模型对本场景过重；
- **不暴露持久化层细节**：不允许 endpoint 直接读 / 写 SQLite；所有访问经业务模块接口；
- **不做 cursor-based pagination 之外的复杂分页**：事件历史的 `since+limit` 是唯一分页模式；
- **不做 webhook**：web 是唯一客户端（[`web-agent-office.md`](web-agent-office.md) §4）；webhook 增加回调复杂度。

## 12. 验收映射

| 设计决策 | 主要需求 |
|---|---|
| 错误码来自 [`actor-runtime.md`](actor-runtime.md) §9 | `NFR-02`、`web-agent-office.md` §8.3 |
| 命令发送返回 202 Accepted + SSE 推送实际状态 | `NFR-06`、`web-agent-office.md` §9 |
| 决策解决响应包含影响摘要 | `web-agent-office.md` §7.4（`REQ-ATT-05`） |
| SSE 用 `Last-Event-ID` 续传 | `REQ-REC-05` |
| `external-result.unknown` 列入不可丢失信号 | `REQ-REC-04`、`web-agent-office.md` §9.3 |
| 写操作不绕过模块所有权 | `architecture.md` §6.3 |
| 不引入认证 / 多租户 | `NFR-09`、`CLAUDE.md` |
| `POST /api/actors` 支持 `Idempotency-Key` | `architecture.md` §9.2 |
| 偏好 API 仅白名单 key | `web-agent-office.md` §5.5 |

## 13. 变更记录

- 2026-09-04 v0.1 初稿。锚定 [`web-agent-office.md`](web-agent-office.md) v0.2 / [`web-tech-stack.md`](web-tech-stack.md) v0.1 / [`actor-runtime.md`](actor-runtime.md) v0.2。Decision / Requirement 领域尚未完整建模，API 形状先按 web-agent-office 需求定义，待后续模块设计补全。