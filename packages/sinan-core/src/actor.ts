/**
 * Shared actor domain types. Used by both the server (state machine,
 * persistence) and the web (rendering office workstation cards) so the
 * wire shape is the same on both sides of the HTTP boundary.
 *
 * Per `docs/web-tech-stack.md` §8.1, the web and server are expected to
 * import from this module rather than redeclaring locally. Adding a new
 * type here is a deliberate cross-cutting change; small variations
 * between the two packages should be avoided.
 */

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

/** Persisted lifecycle states understood by the actor manager. */
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
 * Runtime state. The transient `initializing` variant is held only in
 * memory by the manager and never appears in HTTP/SSE responses or in
 * `actor_config.state_kind`; all other variants are persisted via
 * `state-changed` events.
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
 * Recovery policy per `actor-runtime.md` §7.1.
 *
 * - `never` — failures are sent to quarantine; no auto-restart.
 * - `on-failure` — restart up to `maxRetries` times on transient
 *   failures, waiting `backoffMs` between attempts (jittered when
 *   `jitter` is true). Exceeding `maxRetries` or hitting an
 *   `unrecoverable` error sends the actor to quarantine.
 * - `always` — restart on any exit, including crashes. Suppressible
 *   only by a human `terminate` command.
 */
export type RestartPolicy =
  | { kind: "never" }
  | { kind: "on-failure"; maxRetries: number; backoffMs: number; jitter: boolean }
  | { kind: "always"; backoffMs: number; jitter: boolean };

/** Safe default used when an actor is created without an explicit policy. */
export const DEFAULT_RESTART_POLICY: RestartPolicy = { kind: "never" };

/**
 * External commands accepted by the manager. Mirrors
 * `actor-runtime.md` §5.1; only the commands the current runtime
 * version actually handles are non-throwing. Unsupported commands
 * (e.g. `assign`, `cancel`, `checkpoint`) are reserved for forthcoming
 * task / checkpoint modules and are rejected with `not-implemented`.
 */
export type ActorCommand =
  | { kind: "init" }
  | { kind: "assign"; taskId: TaskId; leaseId: LeaseId }
  | { kind: "pause"; reason: string }
  | { kind: "resume" }
  | { kind: "cancel"; reason: string }
  | { kind: "checkpoint"; note: string | null }
  | { kind: "restart"; reason: string }
  | { kind: "quarantine"; reason: string }
  | { kind: "terminate"; clean: boolean };

/** Error codes from `actor-runtime.md` §9, surfaced to the HTTP layer. */
export type ManagerErrorCode =
  | "actor-not-found"
  | "invalid-state-transition"
  | "policy-violation"
  | "not-implemented"
  | "persistence-unavailable";
