import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { Database } from "../persistence/database.js";
import {
  PiAgentSessionFactory,
  type AgentSessionFactory,
} from "./agent.js";
import {
  Actor,
  type ActorConfig,
  type ActorError,
  type ActorId,
  type ActorRole,
  type ActorState,
  type CreateActorInput,
  type EventCause,
  type ResourceLimits,
  type Timestamp,
} from "./actor.js";

const ACTOR_ROLES: readonly ActorRole[] = [
  "product_manager",
  "designer",
  "development_engineer",
  "qa_engineer",
  "devops_engineer",
];

const DEFAULT_LIMITS: ResourceLimits = {
  maxWallClockMs: 60 * 60 * 1000,
  maxConcurrentTasks: 1,
  maxMemoryMb: null,
  maxTokensPerHour: null,
};

/**
 * Creates actors, records their lifecycle facts, and owns active agents.
 *
 * Persistence is intentionally committed before the asynchronous SDK call.
 * Database.transaction only accepts synchronous callbacks, and the committed
 * `created` fact is what allows a later reload to distinguish an uninitialized
 * actor from an actor that was never requested. The manager implements
 * `Disposable` and releases active agent sessions without owning the database.
 */
export class ActorManager<TAgent extends object = AgentSession> implements Disposable {
  private readonly actors = new Map<ActorId, Actor<TAgent>>();
  private readonly sessionDirectory: string;
  private disposed = false;

  public constructor(
    private readonly database: Database,
    private readonly agentFactory: AgentSessionFactory<TAgent> = new PiAgentSessionFactory() as unknown as AgentSessionFactory<TAgent>,
    options: ActorManagerOptions = {},
  ) {
    this.sessionDirectory = resolve(
      options.sessionDirectory
      ?? process.env.SINAN_AGENT_SESSION_DIR
      ?? join(homedir(), ".sinan", "actors"),
    );
  }

  /**
   * Persists an actor configuration, initializes its agent, and returns the
   * ready runtime projection.
   *
   * The first transaction writes `actor_config` and sequence 1 of
   * `actor_event`. Agent initialization happens after that commit. A second
   * transaction records `ready` (or `failed`) so the database remains the
   * source of truth even when the SDK is unavailable. The agent factory receives
   * a stable JSONL session path; Pi owns that file's conversation history.
   *
   * @param input Actor identity and optional runtime configuration.
   * @returns The ready actor projection with its SDK agent.
   * @throws TypeError If identity or configuration values are invalid.
   * @throws Error If persistence or agent initialization fails.
   * @example
   * ```ts
   * const actor = await manager.create({
   *   name: "Builder",
   *   role: "development_engineer",
   *   workspace: "/work/project",
   *   tools: ["read", "bash"],
   * });
   * console.log(actor.id, actor.state.kind); // ready
   * ```
   */
  public async create(input: CreateActorInput): Promise<Actor<TAgent>> {
    this.assertUsable();
    const config = buildConfig(input, this.sessionDirectory);
    const createdAt = config.createdAt;
    const createdState: ActorState = { kind: "created" };

    this.database.transaction(() => {
      this.database.run(
        `INSERT INTO actor_config (id, config_json, state_kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        config.id,
        JSON.stringify(config),
        createdState.kind,
        createdAt,
        createdAt,
      );
      this.appendStateEvent(config.id, 1, null, createdState, {
        kind: "command",
        command: "create",
      }, createdAt);
    });

    let agent: TAgent;
    try {
      agent = await this.agentFactory.create({
        workspace: config.workspace,
        sessionFile: config.sessionFile,
        tools: config.tools,
      });
    } catch (cause) {
      const failedAt = Date.now();
      const failedState: ActorState = {
        kind: "failed",
        error: toActorError(cause),
        since: failedAt,
      };
      try {
        this.persistState(config.id, 2, createdState, failedState, {
          kind: "external-error",
        }, failedAt);
      } catch (persistenceCause) {
        throw new AggregateError(
          [cause, persistenceCause],
          `Actor ${config.id} failed to initialize and record its failure`,
          { cause },
        );
      }
      throw cause;
    }

    // A synchronous dispose() may happen while the asynchronous factory is
    // running. Do not let an agent escape after its owner has been disposed.
    if (this.disposed) {
      disposeAgentQuietly(agent);
      throw new Error("ActorManager is disposed");
    }

    const readyState: ActorState = { kind: "ready" };
    try {
      this.persistState(config.id, 2, createdState, readyState, {
        kind: "command",
        command: "init",
      }, Date.now());
    } catch (cause) {
      disposeAgent(agent);
      throw cause;
    }

    const actor = new Actor(config, readyState, agent);
    this.actors.set(config.id, actor);
    return actor;
  }

  /**
   * Reconciles active actors after a server restart.
   *
   * Full recovery policy is intentionally a later manager operation; this
   * method currently provides the existing scaffold's no-op contract.
   */
  public async reload(): Promise<void> {
    // Recovery will reconstruct projections from actor_config and actor_event.
  }

  /**
   * Releases all active agents owned by this manager.
   *
   * The injected database and persisted Pi session files are owned by their
   * respective application/storage lifecycles and are intentionally left open.
   * Repeated disposal is safe. All agent cleanup attempts run before an
   * AggregateError is reported, so one broken agent cannot strand the rest.
   */
  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const errors: unknown[] = [];
    for (const actor of this.actors.values()) {
      try {
        disposeAgent(actor.agent);
      } catch (cause) {
        errors.push(cause);
      }
    }
    this.actors.clear();

    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to dispose one or more actor agents");
    }
  }

  /** Supports `using manager = new ActorManager(...)`. */
  public [Symbol.dispose](): void {
    this.dispose();
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error("ActorManager is disposed");
    }
  }

  /** Appends one state transition to the actor's immutable event history. */
  private appendStateEvent(
    actorId: ActorId,
    sequence: number,
    from: ActorState | null,
    to: ActorState,
    cause: EventCause,
    at: Timestamp,
  ): void {
    this.database.run(
      `INSERT INTO actor_event (actor_id, sequence, event_id, event_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      actorId,
      sequence,
      randomUUID(),
      JSON.stringify({ kind: "state-changed", from, to, at, cause }),
      at,
    );
  }

  /** Updates the current state and appends its event atomically. */
  private persistState(
    actorId: ActorId,
    sequence: number,
    from: ActorState,
    to: ActorState,
    cause: EventCause,
    at: Timestamp,
  ): void {
    this.database.transaction(() => {
      const result = this.database.run(
        "UPDATE actor_config SET state_kind = ?, updated_at = ? WHERE id = ?",
        to.kind,
        at,
        actorId,
      );
      if (result.changes !== 1) {
        throw new Error(`Actor ${actorId} does not exist while persisting state`);
      }
      this.appendStateEvent(actorId, sequence, from, to, cause, at);
    });
  }
}

/** Options controlling where Pi's per-actor JSONL sessions are stored. */
export interface ActorManagerOptions {
  sessionDirectory?: string;
}

function buildConfig(input: CreateActorInput, sessionDirectory: string): ActorConfig {
  if (input === null || typeof input !== "object") {
    throw new TypeError("ActorManager.create input must be an object");
  }
  const name = requireText(input.name, "name");
  const workspace = requireText(input.workspace, "workspace");
  if (!ACTOR_ROLES.includes(input.role)) {
    throw new TypeError(`Unsupported actor role: ${String(input.role)}`);
  }

  const id = input.id === undefined ? randomUUID() : requireActorId(input.id);
  const sessionFile = join(sessionDirectory, encodeURIComponent(id), "session.jsonl");
  if (input.tools !== undefined && !Array.isArray(input.tools)) {
    throw new TypeError("Actor tools must be an array");
  }
  const tools = input.tools === undefined ? [] : [...input.tools];
  if (tools.some((tool) => typeof tool !== "string" || tool.trim().length === 0)) {
    throw new TypeError("Actor tools must contain non-empty strings");
  }
  const promptTemplateRef = input.promptTemplateRef === undefined
    ? "default"
    : requireText(input.promptTemplateRef, "promptTemplateRef");
  if (
    input.limits !== undefined
    && (input.limits === null || typeof input.limits !== "object" || Array.isArray(input.limits))
  ) {
    throw new TypeError("Actor limits must be an object");
  }
  const limits = {
    ...DEFAULT_LIMITS,
    ...input.limits,
  };
  validateLimits(limits);

  return {
    id,
    name,
    role: input.role,
    workspace,
    sessionFile,
    tools,
    promptTemplateRef,
    limits,
    createdAt: Date.now(),
  };
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`Actor ${field} must be a non-empty string`);
  }
  return value;
}

function requireActorId(value: unknown): string {
  const id = requireText(value, "id");
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(id)) {
    throw new TypeError("Actor id must contain only letters, numbers, '.', '_' or '-'");
  }
  return id;
}

function validateLimits(limits: ResourceLimits): void {
  if (!Number.isInteger(limits.maxWallClockMs) || limits.maxWallClockMs <= 0) {
    throw new TypeError("Actor maxWallClockMs must be a positive integer");
  }
  if (!Number.isInteger(limits.maxConcurrentTasks) || limits.maxConcurrentTasks <= 0) {
    throw new TypeError("Actor maxConcurrentTasks must be a positive integer");
  }
  for (const [field, value] of [
    ["maxMemoryMb", limits.maxMemoryMb],
    ["maxTokensPerHour", limits.maxTokensPerHour],
  ] as const) {
    if (value !== null && (!Number.isInteger(value) || value <= 0)) {
      throw new TypeError(`Actor ${field} must be a positive integer or null`);
    }
  }
}

function toActorError(cause: unknown): ActorError {
  return {
    category: "external",
    message: errorMessage(cause),
    diagnostic: cause instanceof Error && cause.stack !== undefined ? cause.stack : null,
  };
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function disposeAgent(agent: object): void {
  const disposable = agent as { dispose?: unknown };
  if (typeof disposable.dispose === "function") {
    (disposable.dispose as () => void)();
  }
}

function disposeAgentQuietly(agent: object): void {
  try {
    disposeAgent(agent);
  } catch {
    // The manager is already disposed; there is no active owner to report to.
  }
}
