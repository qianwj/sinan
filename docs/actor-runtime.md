# Sinan Actor Runtime

> **文档性质**：actor 创建、生命周期管理与重启恢复的接口定义；不覆盖任务派工、需求治理、决策路由等上层语义（这些在后续阶段单独定义）。
> **基线**：[`architecture.md`](architecture.md) §5.3（协作与执行层）、§6.1（执行适配）、§9.5（恢复验收）；[`requirements.md`](requirements.md) §4.5（可靠性与恢复）。
> **范围**：只写接口、消息形态、字段语义、不变量与存储 schema；不写实现代码、进程管理逻辑与查询实现。
> **版本**：v0.2 ｜ **状态**：基线（存储后端已钉死为 SQLite） ｜ **更新**：2026-09-02

## 1. 目标与边界

### 1.1 目标

- actor 必须能根据持久化状态创建；
- actor 必须能被监控、暂停、重启、终止；
- server 重启后，已知 actor 必须能恢复到一致点（恢复 / 重启 / 隔离，三选一）；
- 自动重启必须受策略约束，越界或低置信必须升级人工（`REQ-NFR-01`）。

### 1.2 不在本期范围

- 任务分配、worktree 隔离、契约协作（`REQ-COL-*`）；
- 决策管理、注意力路由（`REQ-ATT-*`）；
- 模型 provider 的实现（`architecture.md` §5.6 边界层）；
- 备份可见性（`REQ-REC-06`，下个阶段）；
- 多租户、跨进程集群。

### 1.3 术语

| 术语 | 含义 |
|---|---|
| **actor** | 一个有持久化身份的逻辑实体，承载特定角色（如产品、设计、开发） |
| **actor 状态** | actor 的运行时态，由持久化层提供唯一事实来源 |
| **actor manager** | 创建、监督、查询 actor 的运行时入口 |
| **恢复** | server 启动时根据持久化记录重建 actor 状态的过程 |
| **重启** | 主动或被动重建单个 actor 进程/对象并恢复到一致点 |
| **隔离** | actor 状态不一致时挂起，等待人工决策 |

## 2. 设计原则

1. **持久化是唯一权威**——运行时内存只是镜像（架构 §9.1）。
2. **状态机显式**——actor 的合法状态必须可枚举，状态转移必须经过 manager 接口。
3. **重启分三类**——resume（连续运行）/ restart（从快照重建）/ quarantine（挂起等待人），不可混淆。
4. **人类最终控制**——自动重启受策略约束，跨策略或低置信必须升级人工。
5. **可解释**——每次状态转移必须带原因、时间戳与因果链（`REQ-NFR-02`）。
6. **进程边界清晰**——manager 是 actor 唯一持有者，其他模块只能通过接口查询或发送消息。

## 3. Actor 数据形态

### 3.1 角色与配置

```typescript
// —— 与 pi-coding-agent 角色对应 ——
export type ActorRole =
  | 'product_manager'
  | 'designer'
  | 'development_engineer'
  | 'qa_engineer'
  | 'devops_engineer';

// —— Actor 静态配置（创建后只读） ——
export interface ActorConfig {
  id: ActorId;
  name: string;
  role: ActorRole;
  workspace: string;                     // 关联 worktree / 项目目录
  tools: ReadonlyArray<ToolGrant>;
  promptTemplateRef: string;             // 模板引用
  limits: ResourceLimits;
  createdAt: Timestamp;
}

export interface ToolGrant {
  tool: string;
  scope: 'workspace' | 'contract' | 'system';
  maxInvocations: number | null;
}

export interface ResourceLimits {
  maxWallClockMs: number;
  maxConcurrentTasks: number;
  maxMemoryMb: number | null;
  maxTokensPerHour: number | null;
}
```

不变量：

- `ActorConfig` 创建后只读；修改 = 销毁 + 重建；
- `role` 决定 actor 可承担的子任务类型，但不与任务派工耦合。

### 3.2 运行时状态

```typescript
// —— Actor 状态机 ——（详见 §4）
export type ActorState =
  | { kind: 'created' }                                                  // 配置已注册, 还未初始化
  | { kind: 'ready' }                                                    // 空闲, 可接受任务
  | { kind: 'running'; taskId: TaskId; leaseId: LeaseId }                // 正在执行任务
  | { kind: 'paused'; reason: PauseReason; since: Timestamp }            // 显式暂停
  | { kind: 'failed'; error: ActorError; since: Timestamp }              // 故障, 待恢复决策
  | { kind: 'restarting'; fromCheckpoint: CheckpointId | null }          // 重启中
  | { kind: 'quarantined'; reason: string; since: Timestamp }            // 隔离, 等待人工
  | { kind: 'terminated'; clean: boolean; at: Timestamp };               // 已终止

export type PauseReason =
  | { kind: 'user-requested' }
  | { kind: 'no-work' }
  | { kind: 'lease-expired' }
  | { kind: 'supervisor-policy' };

export interface ActorError {
  category:   'transient' | 'configuration' | 'unrecoverable' | 'external';
  message:    string;
  diagnostic: string | null;             // 详细诊断信息
}
```

## 4. 状态机

```text
created ──init──▶ ready ──assign──▶ running ──complete──▶ ready
                       │                │
                       │                ├──fail──────▶ failed ──decide──┐
                       │                │                              │
                       ├──pause─────────┤                              │
                       │                │                              ├── resume ──▶ ready
                       ▼                ▼                              ├── restart ──▶ restarting ──▶ ready
                     paused          failed                            └── quarantine ──▶ quarantined ──(人)─▶ terminated
```

转移规则：

| from | to | 触发者 | 前置条件 |
|---|---|---|---|
| * | `created` | manager | 注册配置 |
| `created` | `ready` | manager | 初始化完成 |
| `ready` | `running` | manager | 任务分配 + lease 已发 |
| `running` | `ready` | actor | 任务完成 + lease 释放 |
| `running` | `failed` | actor | 故障发生 |
| `ready` / `running` | `paused` | manager | 收到 pause 请求或策略触发 |
| `paused` | `ready` | manager | resume 请求 |
| `failed` | `ready` / `restarting` / `quarantined` | manager | 按恢复决策 |
| `restarting` | `ready` | manager | 从快照恢复成功 |
| `quarantined` | `ready` / `terminated` | manager | 人工决策 |
| * | `terminated` | manager | 显式 terminate |

不变量：

- 不允许 `terminated` → 其他状态的转移（终止后只能重新创建）；
- `quarantined` 只能由人工操作离开（架构 §7.7 未知副作用语义）。

## 5. 消息与事件协议

### 5.1 外部 → Actor（命令）

```typescript
export type ActorCommand =
  | { kind: 'init' }                                                       // 初始化
  | { kind: 'assign'; taskId: TaskId; leaseId: LeaseId; scope: ImpactEnvelope }
  | { kind: 'pause';  reason: PauseReason }
  | { kind: 'resume' }
  | { kind: 'cancel'; reason: string }
  | { kind: 'checkpoint'; note: string | null }                            // 主动创建快照
  | { kind: 'restart'; fromCheckpoint: CheckpointId | null; reason: string }
  | { kind: 'quarantine'; reason: string }
  | { kind: 'terminate'; clean: boolean };
```

### 5.2 Actor → 外部（事件）

```typescript
export type ActorEvent =
  | { kind: 'state-changed';       from: ActorState; to: ActorState; at: Timestamp; cause: EventCause }
  | { kind: 'task-accepted';       taskId: TaskId;    at: Timestamp }
  | { kind: 'progress';            at: Timestamp;     phase: string; note: string | null }
  | { kind: 'log';                 at: Timestamp;     stream: 'stdout' | 'stderr' | 'system'; text: string }
  | { kind: 'checkpoint-created';  checkpointId: CheckpointId; at: Timestamp }
  | { kind: 'output-recorded';     outputId: OutputId; at: Timestamp }
  | { kind: 'lease-renewed';       leaseId: LeaseId;  until: Timestamp }
  | { kind: 'failed';              error: ActorError; at: Timestamp }
  | { kind: 'terminated';          clean: boolean;    at: Timestamp };

export type EventCause =
  | { kind: 'command';         command: ActorCommand['kind'] }
  | { kind: 'lease-expired' }
  | { kind: 'external-error' }
  | { kind: 'recovery' };         // 重启/恢复产生的转移
```

不变量：

- 所有事件**追加写**——不可改写、不可删除（`REQ-REC-05`）；
- 每个 `state-changed` 必须带 `cause` 与 `at`；
- 同一状态转移产生的事件必须有唯一 id（用于订阅去重）。

## 6. ActorManager 接口

manager 是创建、监督、查询 actor 的唯一入口；其他模块不直接持有 actor。

```typescript
export interface ActorManager {
  // —— 创建 ——
  spawn(input: SpawnInput): Promise<Result<ActorId>>;
  register(config: ActorConfig): Promise<Result<ActorId>>;             // 仅登记配置, 不立即启动

  // —— 命令（每个命令对应 §5.1） ——
  send(actorId: ActorId, command: ActorCommand): Promise<Result<void>>;

  // —— 查询 ——
  get(actorId: ActorId): Promise<Result<ActorView>>;
  list(filter?: ActorFilter): Promise<Result<ReadonlyArray<ActorSummary>>>;
  eventsOf(actorId: ActorId, since?: EventSequence): Promise<Result<ReadonlyArray<ActorEvent>>>;

  // —— 终止 ——
  terminate(actorId: ActorId, clean: boolean): Promise<Result<void>>;

  // —— 恢复（见 §8） ——
  reload(): Promise<Result<RecoveryReport>>;
}

export type SpawnInput = {
  config: ActorConfig;
  policy?: RestartPolicy;                  // 默认见 §7.1
  initialCheckpoint?: CheckpointId | null;
};

export interface ActorView {
  id:                ActorId;
  config:            ActorConfig;
  state:             ActorState;
  currentCheckpoint: CheckpointId | null;
  lastEventAt:       Timestamp;
  policy:            RestartPolicy;
}

export interface ActorSummary {
  id:          ActorId;
  role:        ActorRole;
  stateKind:   ActorState['kind'];
  lastEventAt: Timestamp;
}

export interface ActorFilter {
  role?:      ActorRole;
  stateKind?: ActorState['kind'];
  workspace?: string;
}

export type EventSequence = Brand<number, 'EventSequence'>;
```

不变量：

- `spawn` 必须先写持久化（`actor_config` 表 + 初始事件），再激活 actor；中途失败必须回滚；
- `send` 是命令语义——不是订阅——返回值只表示「命令已被 manager 接受」；
- actor 不暴露给其他模块直接操作；任何写入必须经过 manager 接口（架构 §6.2）。

## 7. 监督与策略

### 7.1 重启策略

```typescript
export type RestartPolicy =
  | { kind: 'never' }                                                         // 故障后隔离, 不自动重启
  | { kind: 'on-failure'; maxRetries: number; backoffMs: number; jitter: boolean }
  | { kind: 'always';    backoffMs: number; jitter: boolean };                 // 包括 OOM/崩溃等所有退出

export type RestartDecision =
  | { kind: 'resume' }                                                        // 当前状态可继续, 不重启
  | { kind: 'restart'; fromCheckpoint: CheckpointId | null }
  | { kind: 'quarantine'; reason: string };
```

策略行为：

| 策略 | 触发条件 | 默认动作 |
|---|---|---|
| `never` | 任意故障 | `quarantine` |
| `on-failure` | `transient` 故障且未超过 `maxRetries` | `restart` + 指数退避 |
| `on-failure` | `unrecoverable` 或超过 `maxRetries` | `quarantine` |
| `always` | 任意退出 | `restart`（除非被人工干预取消） |

不变量：

- `quarantine` 必须升级到注意力入口（架构 §7.7），不能自动恢复；
- 越界（如未授权的 lease 过期、外部副作用未确认）一律 `quarantine`；
- 重试计数器在持久化层累计；进程重启后必须可恢复。

### 7.2 Lease 与运行权限

actor 在 `running` 状态持有 lease；lease 过期 = 触发 `running → failed` 转移。

```typescript
export interface ActorSupervisor {
  // —— 在 manager 内部使用，对外不直接暴露 ——
  onLeaseExpired(actorId: ActorId, leaseId: LeaseId): Promise<Result<void>>;
  onHeartbeatMissed(actorId: ActorId, lastBeat: Timestamp): Promise<Result<void>>;
}

export type ActorExitReason =
  | { kind: 'normal'; code: number }
  | { kind: 'crash';  signal: string; coreDump: boolean }
  | { kind: 'lease-revoked' }
  | { kind: 'external-termination'; by: string };
```

不变量：

- lease 过期后 actor 必须停止接受新任务，并把当前任务标记为 `unknown`（架构 §7.7 未知副作用语义）。

## 8. 持久化模型

> 本节确定 actor persistence 的存储后端与初始 schema。实现阶段不得偏离 §8.1 与 §8.3。

### 8.1 存储后端：SQLite（已决策）

**决策**：actor persistence 使用 SQLite（WAL 模式），存为单个本地数据库文件。

依据约束：

| 约束 | 需求/架构锚点 |
|---|---|
| 单用户、local-first | `NFR-03` |
| 一个本地权威数据存储 | 架构 §11 |
| 业务事实幂等（至少一次投递去重） | 架构 §9.2 |
| 过期结果识别与拒绝 | 架构 §9.3 |
| 审计事实链可重建 | `REQ-REC-05` |
| 启动恢复可验证 | 架构 §9.5 |
| 跨 actor 派生视图可查询（quarantine / paused 等） | 架构 §5.1 |

被否决的方案：

- **全局 JSONL**：没有 UNIQUE 约束，事件序号需外部分配，崩溃可能留下半行——违反 `NFR-05`、`REQ-REC-05`。
- **per-actor JSONL 作为领域事件存储**：每个 actor 单独文件，恢复时无法在单一事务内完成「加载 config + events + 写 recovery 事件」；boot `reload()` 必须全目录扫描。这里否决的是用 JSONL 取代 SQLite 领域事实，并不否决 agent SDK 自己的会话文件。
- **per-actor 目录 + 多文件**（如 `~/.sinan/actors/<id>/config.json` + `events.jsonl` + `checkpoints/*.json`）：与 per-actor JSONL 同根问题更重；quarantine / failed / paused 跨 actor 派生视图需遍历所有目录。
- **嵌入式 KV**：SQLite 已覆盖需求，引入第二存储是复杂度收益倒挂。

SQLite 提供的关键能力（对应上表约束）：

- **ACID 事务**：`appendEvent` 与对应的 `state-changed` 事件必须在同一事务内落库，保证 `loadEvents` 不会出现「事件存在但状态未更新」；
- **UNIQUE 约束**：`actor_event(event_id) UNIQUE` 提供消费者幂等（架构 §9.2）；
- **单调序号**：`actor_event(actor_id, sequence)` 复合 PK 保证 per-actor 序列单调；
- **索引**：`actor_checkpoint(actor_id, created_at DESC)` 加速 `loadLatestCheckpoint`；
- **WAL 模式**：读不阻塞写；崩溃后自动恢复到上一个 committed checkpoint。

### 8.1.1 Agent 会话存储

actor 的 Pi agent 会话由 `pi-coding-agent` 的 `SessionManager` 持久化为独立的 JSONL 文件。该文件是 agent 上下文的运行时存储，不是 actor 状态或领域事件的权威来源：

- SQLite 的 `actor_config.config_json` 保存稳定的 `sessionFile` 路径，server 重启后可定位同一个会话；
- 创建新 actor 时使用 `SessionManager.open(sessionFile, ..., workspace)`，文件不存在则初始化可持久化 session，存在则加载历史；Pi 会在首条有效会话内容写入时按 SDK 的延迟策略 materialize JSONL 文件；
- actor 状态转移、恢复事实和审计事件仍然只写 SQLite，并通过 `actor_event` 追踪；
- session 文件损坏或丢失时，actor 事实不会被静默改写，恢复流程应将其报告为运行时上下文故障。

因此，系统采用“SQLite 领域事实 + Pi JSONL agent 上下文”的双层持久化边界，而不是将两者合并为一套事件日志。

### 8.2 两类持久化对象

| 对象 | 用途 | 频率 |
|---|---|---|
| **配置（actor_config）** | actor 静态身份 + 当前 `state_kind` | 创建 / 状态变化 |
| **事件日志（actor_event）** | 状态转移 + 进度 | 每次转移 |

`actor_config` 的 `state_kind` 是冗余列——为 `list({ stateKind: 'quarantined' })` 等查询服务（架构 §3.2 允许派生字段冗余以服务查询）。写入路径必须由持久化层从最新 `state-changed` 事件的 payload 提取，禁止应用层双写。

不变量：

- 事件日志**不可物理删除**（架构 §9.1）；
- 配置 + 事件日志 = 「actor 全部事实」（`REQ-REC-05`）。

### 8.3 Schema

最小子集见 [`docs/actor-schema.sql`](actor-schema.sql)。本文件不重复 DDL；schema 变更需走迁移流程。

当前 actor 配置 schema 由 `001_actor_persistence.sql` 和
`002_actor_config_created_at.sql` 共同建立。后者为已有数据库补充
`actor_config.created_at`，并用原 `updated_at` 回填历史记录。

按最小化原则延后：

- **`actor_checkpoint` 表**：MVP 阶段事件量小，恢复时直接 `loadEvents(since=0)` 重放即可。需要时再加。
- **`actor_processed` 表**：MVP 阶段只有一个 in-process 消费者（manager 自身），用内存 Set 去重即可。需要跨进程/重放时再加。

### 8.4 持久化接口

```typescript
export interface ActorPersistence {
  // —— 配置 ——
  saveConfig(config: ActorConfig): Promise<Result<void>>;
  loadConfig(actorId: ActorId): Promise<Result<ActorConfig | null>>;
  listConfigs(): Promise<Result<ReadonlyArray<ActorConfig>>>;
  deleteConfig(actorId: ActorId): Promise<Result<void>>;          // 仅在 terminated 且清理后

  // —— 快照 ——
  saveCheckpoint(actorId: ActorId, checkpoint: Checkpoint): Promise<Result<void>>;
  loadCheckpoint(checkpointId: CheckpointId): Promise<Result<Checkpoint | null>>;
  loadLatestCheckpoint(actorId: ActorId): Promise<Result<Checkpoint | null>>;
  listCheckpoints(actorId: ActorId): Promise<Result<ReadonlyArray<Checkpoint>>>;

  // —— 事件（append-only） ——
  appendEvent(actorId: ActorId, event: ActorEvent, sequence: EventSequence): Promise<Result<EventSequence>>;
  loadEvents(actorId: ActorId, since: EventSequence): Promise<Result<ReadonlyArray<ActorEvent>>>;
  // —— 消费者幂等 ——
  isProcessed(eventId: string): Promise<Result<boolean>>;
  markProcessed(eventId: string): Promise<Result<void>>;
}

export type CheckpointId = Brand<string, 'Checkpoint'>;

export interface Checkpoint {
  id: CheckpointId;
  actorId: ActorId;
  state: ActorState;
  createdAt: Timestamp;
  note: string | null;
  // —— 恢复所需的最小上下文（由实现定义，本文档不规定字段） ——
  context: Readonly<Record<string, unknown>>;
}
```

不变量：

- `appendEvent` 必须返回单调递增的 `EventSequence`；
- 同一 `(actorId, sequence)` 重复写入必须幂等（架构 §9.2）；
- `saveCheckpoint` 写入前必须先 `appendEvent` 对应的 `checkpoint-created` 事件，保证事件先于快照存在。

### 8.5 启动恢复对账

```typescript
export interface RecoveryCoordinator {
  reconcile(input: ReconcileInput): Promise<Result<RecoveryReport>>;
}

export type ReconcileInput = {
  reason: 'startup' | 'manual' | 'post-crash';
  now: Timestamp;
};

export type RecoveryReport = {
  resumed:      ReadonlyArray<ActorId>;          // 恢复到 running/ready
  restarted:    ReadonlyArray<{ actorId: ActorId; fromCheckpoint: CheckpointId | null }>;
  quarantined:  ReadonlyArray<{ actorId: ActorId; reason: string }>;
  orphans:      ReadonlyArray<ActorId>;         // 事件有但配置缺失, 标记为待归属
  missingConfigs: ReadonlyArray<ActorId>;       // 配置有但无事件, 需要从 latest checkpoint 恢复
};
```

启动序列：

```text
1. ActorPersistence.loadConfigs()                       —— 枚举所有已知 actor
2. 对每个 actor:
   2.1 loadEvents(since=0)                              —— 重建状态历史
   2.2 loadLatestCheckpoint()                           —— 找最近快照
   2.3 按策略决定: resume / restart / quarantine
   2.4 写 recovery 事件（带 cause='recovery'）
3. 对未知 actorId 的孤立事件: 标记为 orphans, 写入孤儿池
4. 生成 RecoveryReport 并返回
5. 启动 HTTP/SSE 监听
```

不变量：

- 恢复过程**禁止**修改 `ActorConfig`（只读快照源）；
- 恢复事件必须可见——`state-changed { cause: 'recovery' }` 是审计事实（`REQ-REC-05`）；
- 恢复完成前不允许对外服务（架构 §9.5）。

## 9. 错误与边界

| 错误码 | 含义 | 是否可重试 | 是否升级人工 |
|---|---|---|---|
| `actor-not-found` | actorId 不存在 | 否 | 否 |
| `invalid-state-transition` | 当前状态不允许该命令 | 否 | 否 |
| `checkpoint-corrupted` | 快照损坏或不一致 | 是（用更早快照） | 视情况 |
| `persistence-unavailable` | 持久化层不可用 | 是（带 backoff） | 否 |
| `lease-expired-during-recovery` | 恢复时发现 lease 已过期 | 否 | 是（quarantine） |
| `inconsistent-state` | 配置/事件/状态三者冲突 | 否 | 是（quarantine） |
| `policy-violation` | 命令违反重启策略（如 `never` 下发 restart） | 否 | 是 |

错误必须跨越到 transport 层（HTTP `TransportError.code`），但本文件不规定映射格式。

## 10. 与其他层的关系

- **上层（任务协作 / 决策）**：通过 `ActorManager.send + list + get` 间接使用，不直接持有 actor。
- **可靠性内核**：事件发布通过 `ReliabilityKernel` 统一管理；manager 不直接连接存储。
- **外部边界**：`pi-coding-agent` 等供应商以「actor 内部实现」存在，对上层不暴露。
- **注意力入口**：所有 `quarantine` 必须出现在注意力队列，等待人工。

## 11. 未决问题

下列决策需要实现阶段或后续迭代确认，本文件不预设答案：

1. **进程模型**：actor 是 in-process 对象，还是每个 actor 独立子进程？现有 `pi-coding-agent` 是 in-process 库，建议 actor 整体 in-process、仅在执行任务时 spawn 短生命周期子进程；但若需要隔离崩溃，可考虑 per-actor 子进程。
2. **快照粒度**：多久打一次快照？默认策略（每 N 个事件 / 每 M 秒）需要在实现阶段补。
3. **quarantine 的自动恢复条件**：是否允许设置超时自动恢复？默认建议：never。
4. **多实例一致性**：单用户单进程不涉及；若后续允许多 server，需重新设计持久化与事件序列。

> §11 第 2 项原为「存储后端」，已于 v0.2 钉死为 SQLite（见 §8.1），本节不再列。

## 12. 相关文档

| 文档 | 范围 |
|---|---|
| [`architecture.md`](architecture.md) | 协作与执行层、模块边界 |
| [`requirements.md`](requirements.md) §4.5 | 可靠性与恢复需求 |
| 后续：任务派工与契约协作 | 不在本期 |
| 后续：交付与决策路由 | 不在本期 |
