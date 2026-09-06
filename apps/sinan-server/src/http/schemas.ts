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

const ACTOR_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

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
}).strict();

export type CreateActorInputBody = z.infer<typeof CreateActorInputSchema>;
