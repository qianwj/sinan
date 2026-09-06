import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
    DEFAULT_RESTART_POLICY,
    Optional,
    type ActorCommand,
    type ActorError,
    type ActorId,
    type ActorRole,
    type ActorState,
    type EventCause,
    type EventSequence,
    type Timestamp,
} from "sinan-core";
import type { Database } from "../persistence/database.js";
import type { EventPublisher, PublishedEvent } from "../events/event_publisher.js";
import { type AgentSessionFactory, PiAgentSessionFactory, } from "./agent.js";
import {
    Actor,
    type ActorConfig,
    type ActorEvent,
    type ActorView,
    type CreateActorInput,
    type RecoveryReport,
    type ResourceLimits,
} from "./actor.js";
import { ActorConfigRepository, ActorEventRepository } from "../persistence/actor.js";
import type { ActorFilter } from "./actor.js";
import { ManagerError } from "./manager_error.js";

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

/** Maximum events returned by a single `eventsOf` call. */
const EVENTS_PAGE_LIMIT_MAX = 200;

/** Default page size when the caller does not specify one. */
const EVENTS_PAGE_LIMIT_DEFAULT = 20;

/** Commands the current runtime version actually handles. The rest throw
 *  `not-implemented` and are reserved for the task / checkpoint modules. */
const HANDLED_COMMANDS: ReadonlySet<ActorCommand["kind"]> = new Set([
    "pause",
    "resume",
    "restart",
    "quarantine",
    "terminate",
]);

/**
 * No-op publisher used when the caller does not inject one. The server
 * always injects `InMemoryEventPublisher`; tests that do not care about
 * fan-out rely on the default to keep their setup terse.
 */
const SILENT_PUBLISHER: EventPublisher = {
    publish() { /* drop */ },
    subscribe() { return () => { /* drop */ }; },
    subscribeAll() { return () => { /* drop */ }; },
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
    private readonly configRepository: ActorConfigRepository;
    private readonly eventRepository: ActorEventRepository;
    private readonly publisher: EventPublisher;
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
        this.configRepository = new ActorConfigRepository(this.database);
        this.eventRepository = new ActorEventRepository(this.database);
        this.publisher = options.publisher ?? SILENT_PUBLISHER;
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
     */
    public async create(input: CreateActorInput): Promise<Actor<TAgent>> {
        this.assertUsable();
        const config = buildConfig(input, this.sessionDirectory);
        const createdAt = config.createdAt;
        const createdState: ActorState = { kind: "created" };
        const initializingState: ActorState = { kind: "initializing" };

        let firstEnvelope: PublishedEvent | undefined;
        this.database.transaction(() => {
            this.configRepository.create(config, createdState, createdAt);
            const result = this.eventRepository.recordStateChanged(
                config.id,
                initializingState,
                createdState,
                { kind: "command", command: "create" },
                createdAt,
            );
            firstEnvelope = makeEnvelope(config.id, result, initializingState, createdState, { kind: "command", command: "create" }, createdAt);
        });
        if (firstEnvelope !== undefined) {
            this.publisher.publish(firstEnvelope);
        }

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
                const envelope = this.persistState(
                    config.id, createdState, failedState,
                    { kind: "external-error" }, failedAt,
                );
                this.publisher.publish(envelope);
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
            const envelope = this.persistState(
                config.id, createdState, readyState,
                { kind: "command", command: "init" },
                Date.now(),
            );
            this.publisher.publish(envelope);
        } catch (cause) {
            disposeAgent(agent);
            throw cause;
        }

        const actor = new Actor(config, readyState, agent);
        this.actors.set(config.id, actor);
        return actor;
    }

    /**
     * Reconciles active actors after a server restart, per `actor-runtime.md` §8.5.
     */
    public async reload(): Promise<RecoveryReport> {
        this.assertUsable();
        const configs = this.configRepository.findAll();
        const knownIds = new Set(configs.map((c) => c.id));

        const resumed: ActorId[] = [];
        const quarantined: { id: ActorId; reason: string }[] = [];
        const missingConfigs: ActorId[] = [];

        for (const config of configs) {
            const latest = this.eventRepository.findLatest(config.id);
            if (!latest.isPresent()) {
                missingConfigs.push(config.id);
                continue;
            }
            const current = latest.get().state;
            if (current.kind === "terminated") {
                continue;
            }
            if (!isResumable(current)) {
                quarantined.push({ id: config.id, reason: recoveryReason(current) });
                continue;
            }
            try {
                await this.resumeAfterRestart(config, current);
                resumed.push(config.id);
            } catch (cause) {
                quarantined.push({ id: config.id, reason: errorMessage(cause) });
            }
        }

        const orphans = this.eventRepository.findOrphanActorIds(knownIds);
        return { resumed, quarantined, orphans, missingConfigs };
    }

    /**
     * Dispatches a command to an actor and applies the corresponding state
     * transition per `actor-runtime.md` §4. Throws `ManagerError` on
     * `actor-not-found`, `invalid-state-transition`, or `not-implemented`.
     * Successful transitions publish a `state-changed` event to the
     * configured `EventPublisher`.
     */
    public send(actorId: ActorId, command: ActorCommand): void {
        this.assertUsable();
        if (!HANDLED_COMMANDS.has(command.kind)) {
            throw new ManagerError(
                "not-implemented",
                `Command '${command.kind}' is not handled by the current runtime version`,
                { command: command.kind },
            );
        }

        const view = this.configRepository.findById(actorId);
        if (view.isEmpty()) {
            throw new ManagerError("actor-not-found", `Actor ${actorId} does not exist`, { actorId });
        }
        const latest = this.eventRepository.findLatest(actorId);
        if (latest.isEmpty()) {
            // Should be impossible: every config row came from `create()`,
            // which always writes an event. If we land here the data store
            // is in an inconsistent state.
            throw new ManagerError(
                "persistence-unavailable",
                `Actor ${actorId} has a config row but no events`,
                { actorId },
            );
        }
        const from = latest.get().state;

        // `terminated` actors are write-once — every command is rejected.
        if (from.kind === "terminated") {
            throw new ManagerError(
                "invalid-state-transition",
                `Actor ${actorId} is terminated and cannot accept commands`,
                { actorId, command: command.kind, state: from.kind },
            );
        }

        const to = computeTargetState(from, command, Date.now());
        if (to === null) {
            throw new ManagerError(
                "invalid-state-transition",
                `Command '${command.kind}' is not valid from state '${from.kind}'`,
                { actorId, command: command.kind, state: from.kind },
            );
        }

        const at = Date.now();
        const cause: EventCause = { kind: "command", command: command.kind };
        const envelope = this.persistState(actorId, from, to, cause, at);
        this.publisher.publish(envelope);
        this.applyToProjection(actorId, to);
    }

    /**
     * Returns the persisted view for an actor, or empty when no such actor
     * exists.
     */
    public get(actorId: ActorId): Optional<ActorView> {
        return this.configRepository
            .findById(actorId)
            .flatMap((config) =>
                this.eventRepository.findLatest(actorId).map((latest) => ({
                    id: actorId,
                    config,
                    state: latest.state,
                    lastEventAt: latest.at,
                })),
            );
    }

    /** Returns the persisted view for every actor that matches `filter`. */
    public list(filter: ActorFilter = {}): ActorView[] {
        return this.configRepository.findAllViews(filter);
    }

    /**
     * Returns events for `actorId` whose sequence is greater than `since`,
     * ordered ascending and capped at `limit`.
     */
    public eventsOf(
        actorId: ActorId,
        since: EventSequence = 0,
        limit: number = EVENTS_PAGE_LIMIT_DEFAULT,
    ): ActorEvent[] {
        if (this.configRepository.findById(actorId).isEmpty()) {
            return [];
        }
        const cappedLimit = Math.max(1, Math.min(limit, EVENTS_PAGE_LIMIT_MAX));
        return this.eventRepository.listSince(actorId, since, cappedLimit);
    }

    /**
     * Releases all active agents owned by this manager.
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

    /**
     * Updates the current state and appends its event atomically. Returns the
     * envelope so callers can publish it without re-reading the row.
     */
    private persistState(
        actorId: ActorId,
        from: ActorState,
        to: ActorState,
        cause: EventCause,
        at: Timestamp,
    ): PublishedEvent {
        let result: { sequence: EventSequence; eventId: string } | undefined;
        this.database.transaction(() => {
            this.configRepository.updateOne(actorId, to, at);
            result = this.eventRepository.recordStateChanged(actorId, from, to, cause, at);
        });
        if (result === undefined) {
            throw new ManagerError(
                "persistence-unavailable",
                `Failed to record state-changed event for ${actorId}`,
                { actorId },
            );
        }
        return makeEnvelope(actorId, result, from, to, cause, at);
    }

    /**
     * Brings one actor back to `ready` after a server restart: writes the
     * recovery event, reopens the Pi session, and registers the live
     * projection. If any step fails, the in-memory map is left untouched so
     * the caller can record the actor as quarantined in the report.
     */
    private async resumeAfterRestart(
        config: ActorConfig,
        current: ActorState,
    ): Promise<void> {
        const readyState: ActorState = { kind: "ready" };
        const recoveryAt = Date.now();
        const envelope = this.persistState(
            config.id, current, readyState, { kind: "recovery" }, recoveryAt,
        );
        this.publisher.publish(envelope);
        const agent = await this.agentFactory.create({
            workspace: config.workspace,
            sessionFile: config.sessionFile,
            tools: config.tools,
        });
        if (this.disposed) {
            disposeAgentQuietly(agent);
            throw new Error("ActorManager is disposed");
        }
        this.actors.set(config.id, new Actor(config, readyState, agent));
    }

    /**
     * Mirrors the persisted state into the in-memory projection. `terminated`
     * removes the actor from the map and disposes its agent; the other
     * states update the `Actor.state` field in place so any live agent
     * reference stays valid.
     */
    private applyToProjection(actorId: ActorId, to: ActorState): void {
        const actor = this.actors.get(actorId);
        if (actor === undefined) return;
        if (to.kind === "terminated") {
            try {
                disposeAgent(actor.agent);
            } catch (cause) {
                console.error(`Failed to dispose agent for terminated actor ${actorId}:`, cause);
            }
            this.actors.delete(actorId);
            return;
        }
        // Replace the projection with a new one carrying the updated state.
        this.actors.set(actorId, new Actor(actor.config, to, actor.agent));
    }
}

/** Options controlling where Pi's per-actor JSONL sessions are stored. */
export interface ActorManagerOptions {
    sessionDirectory?: string;
    /** When provided, state-changed events are fanned out to subscribers. */
    publisher?: EventPublisher;
}

/**
 * Maps a command to the resulting state, or returns `null` when the
 * transition is invalid for `from`. Each branch corresponds to a row in
 * `actor-runtime.md` §4.
 */
function computeTargetState(
    from: ActorState,
    command: ActorCommand,
    at: Timestamp,
): ActorState | null {
    switch (command.kind) {
        case "pause":
            if (from.kind !== "ready" && from.kind !== "running") return null;
            return { kind: "paused", reason: command.reason, since: at };
        case "resume":
            if (from.kind !== "paused") return null;
            return { kind: "ready" };
        case "restart":
            if (
                from.kind !== "paused"
                && from.kind !== "failed"
                && from.kind !== "quarantined"
                && from.kind !== "restarting"
            ) return null;
            // Skips the `restarting` intermediate for now: with no
            // checkpoint table, restoration is instantaneous, so the
            // observer never sees a `restarting` snapshot.
            return { kind: "ready" };
        case "quarantine":
            return { kind: "quarantined", reason: command.reason, since: at };
        case "terminate":
            return { kind: "terminated", clean: command.clean, at };
        case "init":
        case "assign":
        case "cancel":
        case "checkpoint":
            return null; // handled by the not-implemented branch in `send`
        default: {
            // Exhaustiveness: the union of `command.kind` is closed.
            const _unreachable: never = command;
            return _unreachable;
        }
    }
}

/**
 * Conservative policy: only actors that were idle before the restart are
 * resumed automatically.
 */
function isResumable(state: ActorState): boolean {
    return state.kind === "ready" || state.kind === "created";
}

function recoveryReason(state: ActorState): string {
    switch (state.kind) {
        case "running":
            return "lease lost on restart";
        case "paused":
            return "user-paused on restart";
        case "failed":
            return `previously failed: ${state.error.message}`;
        case "quarantined":
            return `quarantined: ${state.reason}`;
        case "restarting":
            return "interrupted while restarting";
        case "initializing":
            return "interrupted before init";
        case "created":
        case "ready":
        case "terminated":
            return state.kind;
    }
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
        policy: input.policy ?? DEFAULT_RESTART_POLICY,
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

function makeEnvelope(
    actorId: ActorId,
    result: { sequence: EventSequence; eventId: string },
    from: ActorState,
    to: ActorState,
    cause: EventCause,
    at: Timestamp,
): PublishedEvent {
    return {
        actorId,
        sequence: result.sequence,
        eventId: result.eventId,
        event: {
            kind: "state-changed",
            sequence: result.sequence,
            from,
            to,
            cause,
            at,
        },
    };
}
