import { z } from "zod";

/**
 * Schema definitions matching `docs/server-http-api.md`.
 *
 * Each schema enforces the wire shape of an endpoint's request body.
 * TypeScript types are inferred via `z.infer<>` and feed directly into
 * the manager's domain types when structurally compatible.
 */

export const ActorRoleSchema = z.enum([
    "product_manager",
    "designer",
    "development_engineer",
    "qa_engineer",
    "devops_engineer",
]);

export const ActorStateKindSchema = z.enum([
    "created",
    "ready",
    "running",
    "paused",
    "failed",
    "restarting",
    "quarantined",
    "terminated",
]);

const ACTOR_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

/**
 * Restart policy from `actor-runtime.md` §7.1. The discriminated union
 * uses a `kind` tag; `never` is the bare variant, `on-failure` and
 * `always` carry retry / backoff fields.
 */
export const RestartPolicySchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("never") }).strict(),
    z.object({
        kind: z.literal("on-failure"),
        maxRetries: z.number().int().positive(),
        backoffMs: z.number().int().positive(),
        jitter: z.boolean(),
    }).strict(),
    z.object({
        kind: z.literal("always"),
        backoffMs: z.number().int().positive(),
        jitter: z.boolean(),
    }).strict(),
]);

export const ResourceLimitsSchema = z.object({
    maxWallClockMs: z.number().int().positive().optional(),
    maxConcurrentTasks: z.number().int().positive().optional(),
    maxMemoryMb: z.number().int().positive().nullable().optional(),
    maxTokensPerHour: z.number().int().positive().nullable().optional(),
}).strict();

export const CreateActorInputSchema = z.object({
    id: z.string().regex(ACTOR_ID_PATTERN).optional(),
    name: z.string().min(1),
    role: ActorRoleSchema,
    workspace: z.string().min(1),
    tools: z.array(z.string().min(1)).optional(),
    promptTemplateRef: z.string().min(1).optional(),
    limits: ResourceLimitsSchema.optional(),
    policy: RestartPolicySchema.optional(),
}).strict();

export type CreateActorInputBody = z.infer<typeof CreateActorInputSchema>;

/**
 * Query parameters accepted by `GET /api/actors`. All fields are optional
 * and combine with AND semantics. The runtime enforces the same predicates
 * as the SQL filter on `ActorConfigRepository.findAllViews`.
 */
export const ListActorsQuerySchema = z.object({
    role: ActorRoleSchema.optional(),
    stateKind: ActorStateKindSchema.optional(),
    workspace: z.string().min(1).optional(),
}).strict();

export type ListActorsQuery = z.infer<typeof ListActorsQuerySchema>;

/**
 * Query parameters accepted by `GET /api/actors/:id/events`. `since` is
 * the last sequence the client has already seen (default 0 = full history);
 * `limit` defaults to 20 and is clamped at the manager layer.
 */
export const ListEventsQuerySchema = z.object({
    since: z.coerce.number().int().min(0).default(0),
    limit: z.coerce.number().int().min(1).default(20),
}).strict();

export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;

/**
 * Command body accepted by `POST /api/actors/:id/commands`. Mirrors
 * `actor-runtime.md` §5.1. Only the commands handled by the current
 * runtime version (pause / resume / restart / quarantine / terminate) are
 * listed here; the rest are rejected with `not-implemented` and added to
 * the schema when the supporting modules land.
 */
export const ActorCommandSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("pause"), reason: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("resume") }).strict(),
    z.object({ kind: z.literal("restart"), reason: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("quarantine"), reason: z.string().min(1) }).strict(),
    z.object({ kind: z.literal("terminate"), clean: z.boolean() }).strict(),
]);

export type ActorCommandBody = z.infer<typeof ActorCommandSchema>;
