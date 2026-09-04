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

/** Runtime state. Only the created, ready, and failed variants are used by create(). */
export type ActorState =
  | { kind: "created" }
  | { kind: "ready" }
  | { kind: "running"; taskId: string; leaseId: string }
  | { kind: "paused"; reason: string; since: Timestamp }
  | { kind: "failed"; error: ActorError; since: Timestamp }
  | { kind: "restarting"; fromCheckpoint: string | null }
  | { kind: "quarantined"; reason: string; since: Timestamp }
  | { kind: "terminated"; clean: boolean; at: Timestamp };

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
