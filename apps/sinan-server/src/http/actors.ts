import type { IncomingMessage, ServerResponse } from "node:http";
import type {
    Actor,
    ActorManager,
    CreateActorInput,
    ResourceLimits,
    Timestamp,
} from "../actors/index.js";
import { HttpError } from "./error_mapper.js";
import { readJsonBody } from "./json_body.js";
import type { RouteDefinition } from "./router.js";
import { CreateActorInputSchema, type CreateActorInputBody } from "./schemas.js";

/**
 * HTTP handlers for `/api/actors`. Only `POST` is wired today; the rest of
 * `docs/server-http-api.md` §4 will land here as subsequent slices.
 */
export class ActorRoutes {
    public constructor(private readonly manager: ActorManager) {}

    public get routes(): readonly RouteDefinition[] {
        return [
            { method: "POST", pattern: "/api/actors", handler: this.create.bind(this) },
        ];
    }

    private async create(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const body = await readJsonBody(req);
        const parsed = CreateActorInputSchema.safeParse(body);
        if (!parsed.success) {
            throw new HttpError(400, "invalid-input", "Request body validation failed", {
                issues: parsed.error.issues,
            });
        }
        const actor = await this.manager.create(toDomainInput(parsed.data));
        // `manager.create` has just persisted two state-changed events, so the
        // persisted view is current. `findLatest` returns the most recent
        // event's `at` — the same wall-clock instant the create call recorded.
        const lastEventAt = this.manager.get(actor.id).map((v) => v.lastEventAt).get() ?? Date.now();
        res.writeHead(201, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(toActorSummary(actor, lastEventAt)));
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

interface ActorSummaryResponse {
    id: string;
    name: string;
    role: string;
    workspace: string;
    state: unknown;
    lastEventAt: number;
}

/**
 * `ActorSummary` shape from `server-http-api.md` §4.1.
 *
 * `lastEventAt` is read from the persisted event log so the wire value
 * reflects the most recent state-changed event, not the current wall-clock.
 */
function toActorSummary(actor: Actor, lastEventAt: Timestamp): ActorSummaryResponse {
    return {
        id: actor.id,
        name: actor.name,
        role: actor.role,
        workspace: actor.workspace,
        state: actor.state,
        lastEventAt,
    };
}
