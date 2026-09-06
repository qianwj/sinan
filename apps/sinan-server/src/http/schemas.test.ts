import assert from "node:assert/strict";
import { test } from "node:test";
import {
    CreateActorInputSchema,
    ListActorsQuerySchema,
    ListEventsQuerySchema,
    RestartPolicySchema,
} from "./schemas.js";

test("RestartPolicySchema accepts never without extra fields", () => {
    const parsed = RestartPolicySchema.parse({ kind: "never" });
    assert.deepEqual(parsed, { kind: "never" });
});

test("RestartPolicySchema accepts on-failure without extra fields", () => {
    const parsed = RestartPolicySchema.parse({ kind: "on-failure" });
    assert.deepEqual(parsed, { kind: "on-failure" });
});

test("RestartPolicySchema accepts on-failure-with-backoff with all fields", () => {
    const parsed = RestartPolicySchema.parse({
        kind: "on-failure-with-backoff",
        maxRetries: 3,
        backoffMs: 1_000,
        jitter: true,
    });
    assert.deepEqual(parsed, {
        kind: "on-failure-with-backoff",
        maxRetries: 3,
        backoffMs: 1_000,
        jitter: true,
    });
});

test("RestartPolicySchema rejects unknown fields via .strict()", () => {
    const result = RestartPolicySchema.safeParse({
        kind: "on-failure-with-backoff",
        maxRetries: 1,
        backoffMs: 1_000,
        jitter: true,
        bogus: 1,
    });
    assert.equal(result.success, false);
});

test("CreateActorInputSchema accepts an explicit policy", () => {
    const parsed = CreateActorInputSchema.parse({
        name: "Builder",
        role: "development_engineer",
        workspace: "/w",
        policy: { kind: "on-failure" },
    });
    assert.deepEqual(parsed.policy, { kind: "on-failure" });
});

test("CreateActorInputSchema defaults the policy by leaving it undefined", () => {
    const parsed = CreateActorInputSchema.parse({
        name: "Builder",
        role: "development_engineer",
        workspace: "/w",
    });
    assert.equal(parsed.policy, undefined);
});

test("CreateActorInputSchema rejects unknown fields via .strict()", () => {
    const result = CreateActorInputSchema.safeParse({
        name: "Builder",
        role: "development_engineer",
        workspace: "/w",
        unexpected: true,
    });
    assert.equal(result.success, false);
});

test("ListActorsQuerySchema returns an empty object when no params are provided", () => {
    const parsed = ListActorsQuerySchema.parse({});
    assert.deepEqual(parsed, {});
});

test("ListActorsQuerySchema accepts a single field", () => {
    assert.deepEqual(ListActorsQuerySchema.parse({ role: "designer" }), { role: "designer" });
    assert.deepEqual(ListActorsQuerySchema.parse({ stateKind: "ready" }), { stateKind: "ready" });
    assert.deepEqual(ListActorsQuerySchema.parse({ workspace: "/w" }), { workspace: "/w" });
});

test("ListActorsQuerySchema rejects unknown filter keys", () => {
    const result = ListActorsQuerySchema.safeParse({ role: "designer", bogus: 1 });
    assert.equal(result.success, false);
});

test("ListEventsQuerySchema coerces and defaults query parameters", () => {
    const parsed = ListEventsQuerySchema.parse({ since: "5", limit: "10" });
    assert.deepEqual(parsed, { since: 5, limit: 10 });
    const defaults = ListEventsQuerySchema.parse({});
    assert.deepEqual(defaults, { since: 0, limit: 20 });
});

test("ListEventsQuerySchema rejects negative since and non-positive limit", () => {
    assert.equal(ListEventsQuerySchema.safeParse({ since: -1 }).success, false);
    assert.equal(ListEventsQuerySchema.safeParse({ limit: 0 }).success, false);
});
