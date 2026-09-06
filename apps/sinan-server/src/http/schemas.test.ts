import assert from "node:assert/strict";
import { test } from "node:test";
import {
    ActorCommandSchema,
    CreateActorInputSchema,
    ListActorsQuerySchema,
    ListEventsQuerySchema,
    RestartPolicySchema,
} from "./schemas.js";

test("RestartPolicySchema accepts never without extra fields", () => {
    const parsed = RestartPolicySchema.parse({ kind: "never" });
    assert.deepEqual(parsed, { kind: "never" });
});

test("RestartPolicySchema accepts on-failure with retry / backoff fields", () => {
    const parsed = RestartPolicySchema.parse({
        kind: "on-failure",
        maxRetries: 3,
        backoffMs: 1_000,
        jitter: true,
    });
    assert.deepEqual(parsed, {
        kind: "on-failure",
        maxRetries: 3,
        backoffMs: 1_000,
        jitter: true,
    });
});

test("RestartPolicySchema accepts always with backoff fields", () => {
    const parsed = RestartPolicySchema.parse({
        kind: "always",
        backoffMs: 5_000,
        jitter: false,
    });
    assert.deepEqual(parsed, { kind: "always", backoffMs: 5_000, jitter: false });
});

test("RestartPolicySchema rejects unknown fields via .strict()", () => {
    const result = RestartPolicySchema.safeParse({
        kind: "on-failure",
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
        policy: { kind: "always", backoffMs: 1_000, jitter: false },
    });
    assert.deepEqual(parsed.policy, { kind: "always", backoffMs: 1_000, jitter: false });
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

test("ActorCommandSchema accepts each handled command", () => {
    assert.deepEqual(ActorCommandSchema.parse({ kind: "pause", reason: "user" }), { kind: "pause", reason: "user" });
    assert.deepEqual(ActorCommandSchema.parse({ kind: "resume" }), { kind: "resume" });
    assert.deepEqual(ActorCommandSchema.parse({ kind: "restart", reason: "bug" }), { kind: "restart", reason: "bug" });
    assert.deepEqual(ActorCommandSchema.parse({ kind: "quarantine", reason: "stuck" }), { kind: "quarantine", reason: "stuck" });
    assert.deepEqual(ActorCommandSchema.parse({ kind: "terminate", clean: true }), { kind: "terminate", clean: true });
});

test("ActorCommandSchema rejects unhandled command kinds (init, assign, cancel, checkpoint)", () => {
    for (const body of [
        { kind: "init" },
        { kind: "assign", taskId: "t", leaseId: "l" },
        { kind: "cancel", reason: "x" },
        { kind: "checkpoint", note: null },
    ]) {
        assert.equal(ActorCommandSchema.safeParse(body).success, false, JSON.stringify(body));
    }
});

test("ActorCommandSchema requires the reason field for pause, restart, quarantine", () => {
    assert.equal(ActorCommandSchema.safeParse({ kind: "pause" }).success, false);
    assert.equal(ActorCommandSchema.safeParse({ kind: "pause", reason: "" }).success, false);
    assert.equal(ActorCommandSchema.safeParse({ kind: "restart" }).success, false);
    assert.equal(ActorCommandSchema.safeParse({ kind: "quarantine" }).success, false);
});

test("ActorCommandSchema rejects unknown fields via .strict()", () => {
    assert.equal(ActorCommandSchema.safeParse({ kind: "resume", extra: 1 }).success, false);
});
