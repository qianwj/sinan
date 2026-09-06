import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import {
    DEFAULT_RESTART_POLICY,
    type Actor,
    type ActorCommand,
    type ActorEvent,
    type ActorFilter,
    type ActorId,
    type ActorManager,
    type ActorState,
    type ActorView,
    type CreateActorInput,
    type RestartPolicy,
    type ResourceLimits,
    type Timestamp,
} from "../actors/index.js";
import { HttpError } from "./error_mapper.js";
import type { IdempotencyStore } from "./idempotency.js";
import { readJsonBody } from "./json_body.js";
import type { RouteDefinition, RouteParams } from "./router.js";
import {
    ActorCommandSchema,
    CreateActorInputSchema,
    ListActorsQuerySchema,
    ListEventsQuerySchema,
    type CreateActorInputBody,
    type ListActorsQuery,
    type ListEventsQuery,
} from "./schemas.js";

/** JSON body shape returned for a single actor (per `server-http-api.md` §4.1). */
interface ActorResponse {
    id: string;
    name: string;
    role: string;
    workspace: string;
    policy: RestartPolicy;
    state: ActorState;
    lastEventAt: number;
}

/**
 * HTTP handlers for `/api/actors/*`. Wires up the routes documented in
 * `docs/server-http-api.md` §4 — `POST` create, `GET` list, `GET` detail,
 * `GET` event log.
 *
 * Mutating endpoints (`POST`) honor the `Idempotency-Key` header so a
 * retried request replays the original response. Read endpoints are
 * inherently safe and ignore the header.
 *
 * The class is generic over the manager's agent type so the test suite
 * can substitute a fake factory. The exposed route surface never leaks
 * the agent type to callers.
 */
export class ActorRoutes<TAgent extends object = object> {
    public constructor(
        private readonly manager: ActorManager<TAgent>,
        private readonly idempotency: IdempotencyStore,
    ) {}

    public get routes(): readonly RouteDefinition[] {
        return [
            { method: "POST", pattern: "/api/actors", handler: this.create.bind(this) },
            { method: "GET", pattern: "/api/actors", handler: this.list.bind(this) },
            { method: "GET", pattern: "/api/actors/:id", handler: this.detail.bind(this) },
            { method: "GET", pattern: "/api/actors/:id/events", handler: this.events.bind(this) },
            { method: "POST", pattern: "/api/actors/:id/commands", handler: this.sendCommand.bind(this) },
        ];
    }

    /**
     * `POST /api/actors` — create a new actor. Honors `Idempotency-Key` per
     * `server-http-api.md` §3.4: a replay returns the original 2xx
     * response for the same key within 24h.
     */
    private async create(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const idempotencyKey = readIdempotencyKey(req);
        if (idempotencyKey !== null) {
            const replay = this.idempotency.get(idempotencyKey);
            if (replay.isPresent()) {
                const stored = replay.get();
                res.writeHead(stored.status, stored.headers);
                res.end(stored.body);
                return;
            }
        }

        const body = await readJsonBody(req);
        const parsed = CreateActorInputSchema.safeParse(body);
        if (!parsed.success) {
            throw new HttpError(400, "invalid-input", "Request body validation failed", {
                issues: parsed.error.issues,
            });
        }
        const actor = await this.manager.create(toDomainInput(parsed.data));
        const lastEventAt = this.manager.get(actor.id).map((v) => v.lastEventAt).get() ?? Date.now();
        const responseBody = JSON.stringify(toActorResponse(actor, lastEventAt));
        const responseHeaders = { "content-type": "application/json; charset=utf-8" };

        if (idempotencyKey !== null) {
            this.idempotency.set(idempotencyKey, {
                status: 201,
                headers: responseHeaders,
                body: responseBody,
            });
        }

        res.writeHead(201, responseHeaders);
        res.end(responseBody);
    }

    /**
     * `GET /api/actors` — list actors. Optional query parameters
     * `?role=`, `?stateKind=`, `?workspace=` combine with AND semantics.
     */
    private async list(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const query = parseListQuery(req);
        const views = this.manager.list(toActorFilter(query));
        const actors = views.map((view) => toActorResponseFromView(view));
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ actors }));
    }

    /**
     * `GET /api/actors/:id` — fetch a single actor by id. 404 `not-found`
     * when the id is not present in the persisted config table.
     */
    private async detail(_req: IncomingMessage, res: ServerResponse, params: RouteParams): Promise<void> {
        const id = requireIdParam(params);
        const view = this.manager.get(id);
        if (view.isEmpty()) {
            throw new HttpError(404, "not-found", `Actor ${id} does not exist`);
        }
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(toActorResponseFromView(view.get())));
    }

    /**
     * `GET /api/actors/:id/events?since=N&limit=20` — paginated event log.
     * The cap and the `since` predicate match `ActorManager.eventsOf`.
     */
    private async events(req: IncomingMessage, res: ServerResponse, params: RouteParams): Promise<void> {
        const id = requireIdParam(params);
        const query = parseEventsQuery(req);
        const events = this.manager.eventsOf(id, query.since, query.limit);
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ events }));
    }

    /**
     * `POST /api/actors/:id/commands` — send a command to one actor. The
     * command body is validated by `ActorCommandSchema`; the manager then
     * validates the state transition and throws `ManagerError` for
     * `actor-not-found` / `invalid-state-transition` / `not-implemented`,
     * each of which the error mapper translates to a 4xx / 5xx status.
     */
    private async sendCommand(req: IncomingMessage, res: ServerResponse, params: RouteParams): Promise<void> {
        const id = requireIdParam(params);
        const body = await readJsonBody(req);
        const parsed = ActorCommandSchema.safeParse(body);
        if (!parsed.success) {
            throw new HttpError(400, "invalid-input", "Command body validation failed", {
                issues: parsed.error.issues,
            });
        }
        const command = toActorCommand(id, parsed.data);
        this.manager.send(id, command);
        res.writeHead(202, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ accepted: command }));
    }
}

/**
 * Bridges Zod's mutable-array inference and `T | undefined` optional fields
 * to the domain's `readonly string[]` and `exactOptionalPropertyTypes`
 * shapes. Each optional field is assigned only when present so that no
 * `undefined` slips into the domain input.
 */
function toDomainInput(body: CreateActorInputBody): CreateActorInput {
    const input: CreateActorInput = {
        name: body.name,
        role: body.role,
        workspace: body.workspace,
    };
    if (body.id !== undefined) input.id = body.id;
    if (body.tools !== undefined) input.tools = body.tools;
    if (body.promptTemplateRef !== undefined) input.promptTemplateRef = body.promptTemplateRef;
    if (body.limits !== undefined) {
        input.limits = compactLimits(body.limits);
    }
    if (body.policy !== undefined) {
        input.policy = body.policy;
    }
    return input;
}

function compactLimits(
    limits: NonNullable<CreateActorInputBody["limits"]>,
): Partial<ResourceLimits> {
    const out: Partial<ResourceLimits> = {};
    if (limits.maxWallClockMs !== undefined) out.maxWallClockMs = limits.maxWallClockMs;
    if (limits.maxConcurrentTasks !== undefined) out.maxConcurrentTasks = limits.maxConcurrentTasks;
    if (limits.maxMemoryMb !== undefined) out.maxMemoryMb = limits.maxMemoryMb;
    if (limits.maxTokensPerHour !== undefined) out.maxTokensPerHour = limits.maxTokensPerHour;
    return out;
}

/**
 * Convert an in-memory `Actor` projection (the return of `manager.create`)
 * to the wire response shape. `lastEventAt` is read from the persisted
 * event log, not the wall-clock, so the value reflects the most recent
 * state-changed event for the actor.
 */
function toActorResponse(actor: Actor, lastEventAt: Timestamp): ActorResponse {
    return {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        workspace: actor.workspace,
        policy: actor.config.policy,
        state: actor.state,
        lastEventAt,
    };
}

/**
 * Convert a persisted `ActorView` to the wire response shape. Defaults
 * `policy` to `DEFAULT_RESTART_POLICY` if the row was written before the
 * field existed (the repository already normalizes this on read, but the
 * type guard keeps the response constructor local).
 */
function toActorResponseFromView(view: ActorView): ActorResponse {
    return {
        id: view.id,
        name: view.config.name,
        role: view.config.role,
        workspace: view.config.workspace,
        policy: view.config.policy ?? DEFAULT_RESTART_POLICY,
        state: view.state,
        lastEventAt: view.lastEventAt ?? 0,
    };
}

/**
 * Converts the Zod-typed list query into the domain `ActorFilter`. Each
 * field is assigned only when defined so `exactOptionalPropertyTypes`
 * stays happy; an absent filter is the empty object.
 */
function toActorFilter(query: ListActorsQuery): ActorFilter {
    const filter: ActorFilter = {};
    if (query.role !== undefined) filter.role = query.role;
    if (query.stateKind !== undefined) filter.stateKind = query.stateKind;
    if (query.workspace !== undefined) filter.workspace = query.workspace;
    return filter;
}

/** Reads and validates the list endpoint's query parameters. */
/**
 * Bridges the Zod-parsed command body to the domain `ActorCommand`. Each
 * branch maps to a single domain command variant; the Zod discriminator
 * has already constrained `kind` to the handled set.
 */
function toActorCommand(actorId: ActorId, body: { kind: ActorCommand["kind"] } & Record<string, unknown>): ActorCommand {
    switch (body.kind) {
        case "pause":
            return { kind: "pause", reason: body["reason"] as string };
        case "resume":
            return { kind: "resume" };
        case "restart":
            return { kind: "restart", reason: body["reason"] as string };
        case "quarantine":
            return { kind: "quarantine", reason: body["reason"] as string };
        case "terminate":
            return { kind: "terminate", clean: body["clean"] as boolean };
        case "init":
        case "assign":
        case "cancel":
        case "checkpoint":
            throw new HttpError(501, "not-implemented", `Command '${body.kind}' is not handled`);
    }
}

function parseListQuery(req: IncomingMessage): ListActorsQuery {
    const raw = parseQueryString(req);
    const result = ListActorsQuerySchema.safeParse(raw);
    if (!result.success) {
        throw new HttpError(400, "invalid-input", "Query parameter validation failed", {
            issues: result.error.issues,
        });
    }
    return result.data;
}

/** Reads and validates the events endpoint's query parameters. */
function parseEventsQuery(req: IncomingMessage): ListEventsQuery {
    const raw = parseQueryString(req);
    const result = ListEventsQuerySchema.safeParse(raw);
    if (!result.success) {
        throw new HttpError(400, "invalid-input", "Query parameter validation failed", {
            issues: result.error.issues,
        });
    }
    return result.data;
}

function parseQueryString(req: IncomingMessage): Record<string, string> {
    const rawUrl = req.url ?? "/";
    const host = req.headers.host ?? "localhost";
    const params = new URL(rawUrl, `http://${host}`).searchParams;
    const out: Record<string, string> = {};
    for (const [key, value] of params) {
        out[key] = value;
    }
    return out;
}

function requireIdParam(params: RouteParams): ActorId {
    const id = params["id"];
    if (id === undefined || id.length === 0) {
        throw new HttpError(400, "invalid-input", "Missing actor id in path");
    }
    return id;
}

/**
 * Reads the `Idempotency-Key` header, returning `null` when absent or
 * whitespace-only. Per `server-http-api.md` §3.4 the value is opaque;
 * callers must provide a UUID or other unique token.
 */
function readIdempotencyKey(req: IncomingMessage): string | null {
    const raw = req.headers["idempotency-key"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    if (value === undefined || value.trim().length === 0) {
        return null;
    }
    return value;
}

// Re-export the event type so callers using the actors module see the
// same shape returned by the events endpoint.
export type { ActorEvent };
