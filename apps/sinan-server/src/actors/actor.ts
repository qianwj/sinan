/** Roles available to actors in the first runtime version. */
export type ActorRole =
  | "product_manager"
  | "designer"
  | "development_engineer"
  | "qa_engineer"
  | "devops_engineer";

/** Stable identifier assigned to a persisted actor. */
export type ActorId = string;

/** Milliseconds since the Unix epoch. */
export type Timestamp = number;

/** Stable per-actor monotonic event counter (1-based, gap-free within an actor). */
export type EventSequence = number;

/** Identifier aliases. Treated as opaque strings; brand-flavored at the call site. */
export type TaskId = string;
export type CheckpointId = string;
export type OutputId = string;
export type LeaseId = string;

/** Persisted lifecycle states understood by ActorManager. */
export type ActorStateKind =
  | "created"
  | "ready"
  | "running"
  | "paused"
  | "failed"
  | "restarting"
  | "quarantined"
  | "terminated";

/** Cause recorded for each lifecycle state transition. */
export type EventCause =
  | { kind: "command"; command: string }
  | { kind: "lease-expired" }
  | { kind: "external-error" }
  | { kind: "recovery" };

/** A small, serializable error description used by failed actor states. */
export interface ActorError {
  category: "transient" | "configuration" | "unrecoverable" | "external";
  message: string;
  diagnostic: string | null;
}

/**
 * Recovery policy attached to an actor. The policy is consulted by the
 * supervisor when a runtime failure occurs and decides whether the actor
 * should be restarted automatically or sent to quarantine for human review.
 *
 * - `never` — failures are sent to quarantine; no auto-restart.
 * - `on-failure` — restart once on transient failure.
 * - `on-failure-with-backoff` — restart up to `maxRetries` times, waiting
 *   `backoffMs` between attempts (jittered when `jitter` is true).
 *
 * Note: `server-http-api.md` §4.1 shows a response example that mixes
 * `kind: "on-failure"` with the `maxRetries` / `backoffMs` / `jitter`
 * fields. Those fields belong on `on-failure-with-backoff` per the §7.1
 * policy table. We follow §7.1 here and treat the §4.1 example as a
 * documentation typo to be cleaned up in a future spec revision.
 */
export type RestartPolicy =
  | { kind: "never" }
  | { kind: "on-failure" }
  | {
      kind: "on-failure-with-backoff";
      maxRetries: number;
      backoffMs: number;
      jitter: boolean;
    };

/** Safe default used when an actor is created without an explicit policy. */
export const DEFAULT_RESTART_POLICY: RestartPolicy = { kind: "never" };

/**
 * Runtime state.
 *
 * - `initializing` is a transient, in-memory state held only by
 *   `ActorManager.create` between issuing the create event and the agent
 *   factory returning a session. It is never persisted to `actor_config.state_kind`
 *   and never appears in HTTP/SSE responses.
 * - All other variants are persisted via `state-changed` events and reflected
 *   in `actor_config.state_kind` for query support.
 */
export type ActorState =
  | { kind: "initializing" }
  | { kind: "created" }
  | { kind: "ready" }
  | { kind: "running"; taskId: TaskId; leaseId: LeaseId }
  | { kind: "paused"; reason: string; since: Timestamp }
  | { kind: "failed"; error: ActorError; since: Timestamp }
  | { kind: "restarting"; fromCheckpoint: CheckpointId | null }
  | { kind: "quarantined"; reason: string; since: Timestamp }
  | { kind: "terminated"; clean: boolean; at: Timestamp };

/**
 * Persisted event recorded against an actor. The shape mirrors
 * `actor-runtime.md` §5.2. Only `state-changed` is emitted by the manager today;
 * the remaining variants are reserved for forthcoming task / checkpoint modules.
 */
export type ActorEvent =
  | {
      kind: "state-changed";
      sequence: EventSequence;
      from: ActorState;
      to: ActorState;
      cause: EventCause;
      at: Timestamp;
    }
  | { kind: "task-accepted"; sequence: EventSequence; taskId: TaskId; at: Timestamp }
  | { kind: "progress"; sequence: EventSequence; at: Timestamp; phase: string; note: string | null }
  | {
      kind: "log";
      sequence: EventSequence;
      at: Timestamp;
      stream: "stdout" | "stderr" | "system";
      text: string;
    }
  | { kind: "checkpoint-created"; sequence: EventSequence; checkpointId: CheckpointId; at: Timestamp }
  | { kind: "output-recorded"; sequence: EventSequence; outputId: OutputId; at: Timestamp }
  | { kind: "lease-renewed"; sequence: EventSequence; leaseId: LeaseId; until: Timestamp }
  | { kind: "failed"; sequence: EventSequence; error: ActorError; at: Timestamp }
  | { kind: "terminated"; sequence: EventSequence; clean: boolean; at: Timestamp };

/** Static actor configuration. It is stored as JSON and treated as immutable. */
export interface ActorConfig {
  id: ActorId;
  name: string;
  role: ActorRole;
  workspace: string;
  /** Absolute path to the Pi JSONL session owned by this actor. */
  sessionFile: string;
  tools: readonly string[];
  promptTemplateRef: string;
  limits: ResourceLimits;
  /**
   * Recovery policy persisted alongside the rest of the static config. Stored
   * in `actor_config.config_json` alongside the other fields; the column does
   * not need a schema change. `ActorConfigRepository.parseConfigRow` defaults
   * this to `DEFAULT_RESTART_POLICY` for rows written before the field
   * existed, so callers always see a concrete value.
   */
  policy: RestartPolicy;
  createdAt: Timestamp;
}

/** Resource limits reserved for future supervisor enforcement. */
export interface ResourceLimits {
  maxWallClockMs: number;
  maxConcurrentTasks: number;
  maxMemoryMb: number | null;
  maxTokensPerHour: number | null;
}

/** Input accepted by ActorManager.create. */
export interface CreateActorInput {
  id?: string;
  name: string;
  role: ActorRole;
  workspace: string;
  tools?: readonly string[];
  promptTemplateRef?: string;
  limits?: Partial<ResourceLimits>;
  /** Optional recovery policy. Defaults to `DEFAULT_RESTART_POLICY` (never). */
  policy?: RestartPolicy;
}

/**
 * Read-only projection returned by `ActorManager.get` and `list`. Holds the
 * persisted config, the latest known state, and the timestamp of the most
 * recent event — enough to render an office workstation card without holding
 * a live agent reference.
 */
export interface ActorView {
  id: ActorId;
  config: ActorConfig;
  state: ActorState;
  lastEventAt: Timestamp | null;
}

/** Compact view used by `ActorManager.list`. */
export interface ActorSummary {
  id: ActorId;
  role: ActorRole;
  stateKind: ActorStateKind;
  lastEventAt: Timestamp | null;
  workspace: string;
}

/** Optional predicate accepted by `ActorManager.list`. */
export interface ActorFilter {
  role?: ActorRole;
  stateKind?: ActorStateKind;
  workspace?: string;
}

/**
 * Output of `ActorManager.reload`, per `actor-runtime.md` §8.5.
 *
 * - `resumed` — actors that were transitioned into `ready` during recovery
 * - `quarantined` — actors that should not auto-resume (state, factory error, etc.)
 * - `orphans` — events whose `actor_id` does not match any persisted config
 * - `missingConfigs` — ids referenced by an external (e.g. blackboard) system
 *   that have no `actor_config` row; reserved for a future blackboard module.
 */
export interface RecoveryReport {
  readonly resumed: readonly ActorId[];
  readonly quarantined: readonly { readonly id: ActorId; readonly reason: string }[];
  readonly orphans: readonly ActorId[];
  readonly missingConfigs: readonly ActorId[];
}

/**
 * In-memory projection of a persisted actor and its active agent.
 *
 * The manager owns this object. Callers should use ActorManager methods for
 * state changes instead of mutating the projection directly.
 */
export class Actor<TAgent extends object = object> {
  public readonly id: ActorId;
  public readonly name: string;
  public readonly role: ActorRole;
  public readonly workspace: string;
  /** Pi JSONL session path; equivalent to `config.sessionFile`. */
  public readonly sessionFile: string;
  public readonly config: ActorConfig;
  public readonly state: ActorState;
  public readonly agent: TAgent;

  public constructor(config: ActorConfig, state: ActorState, agent: TAgent) {
    this.id = config.id;
    this.name = config.name;
    this.role = config.role;
    this.workspace = config.workspace;
    this.sessionFile = config.sessionFile;
    this.config = config;
    this.state = state;
    this.agent = agent;
  }
}
