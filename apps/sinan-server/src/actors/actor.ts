import type {
    ActorConfig,
    ActorError,
    ActorId,
    ActorRole,
    ActorState,
    CheckpointId,
    EventCause,
    EventSequence,
    LeaseId,
    OutputId,
    RestartPolicy,
    ResourceLimits,
    TaskId,
    Timestamp,
} from "sinan-core";

/**
 * Persisted event recorded against an actor. The shape mirrors
 * `actor-runtime.md` §5.2. Only `state-changed` is emitted by the manager
 * today; the remaining variants are reserved for forthcoming task /
 * checkpoint modules.
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
