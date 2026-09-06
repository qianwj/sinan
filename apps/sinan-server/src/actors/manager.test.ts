import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ActorManager,
  type AgentSessionFactory,
  type CreateAgentSessionOptions,
  InMemoryEventPublisher,
  type PublishedEvent,
  ManagerError,
} from "./index.js";
import { Database } from "../persistence/database.js";

const ACTOR_SCHEMA = `
  CREATE TABLE actor_config (
    id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL,
    state_kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE actor_event (
    actor_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_id TEXT NOT NULL,
    event_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (actor_id, sequence)
  );
  CREATE UNIQUE INDEX idx_event_id ON actor_event(event_id);
`;

test("create persists actor facts and passes a durable session path to the agent factory", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const calls: CreateAgentSessionOptions[] = [];
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create(input) {
      calls.push(input);
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, { sessionDirectory: "/tmp/sinan-test-sessions" });

  const actor = await manager.create({
    id: "actor-1",
    name: "Builder",
    role: "development_engineer",
    workspace: "/work/project",
    tools: ["read", "bash"],
  });

  assert.equal(actor.state.kind, "ready");
  assert.equal(actor.agent.kind, "fake");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.workspace, "/work/project");
  assert.equal(calls[0]?.sessionFile, "/tmp/sinan-test-sessions/actor-1/session.jsonl");

  const config = database.get<{
    id: string;
    config_json: string;
    state_kind: string;
    created_at: number;
    updated_at: number;
  }>(
    "SELECT id, config_json, state_kind, created_at, updated_at FROM actor_config WHERE id = ?",
    "actor-1",
  ).orElseThrow();
  assert.equal(config.state_kind, "ready");
  assert.ok(config.updated_at >= config.created_at);
  assert.equal(JSON.parse(config.config_json).sessionFile, calls[0]?.sessionFile);

  const events = database.all<{ sequence: number; event_json: string }>(
    "SELECT sequence, event_json FROM actor_event WHERE actor_id = ? ORDER BY sequence",
    "actor-1",
  );
  assert.deepEqual(events.map((event) => event.sequence), [1, 2]);
  assert.deepEqual(JSON.parse(events[0]?.event_json ?? "{}").to, { kind: "created" });
  assert.deepEqual(JSON.parse(events[1]?.event_json ?? "{}").to, { kind: "ready" });
});

test("create records a failed state when agent initialization fails", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const failure = new Error("provider unavailable");
  const factory: AgentSessionFactory<object> = {
    async create() {
      throw failure;
    },
  };
  const manager = new ActorManager(database, factory);

  await assert.rejects(
    manager.create({
      id: "actor-failed",
      name: "Unavailable",
      role: "product_manager",
      workspace: "/work/project",
    }),
    (error: unknown) => error === failure,
  );

  const state = database.get<{ state_kind: string }>(
    "SELECT state_kind FROM actor_config WHERE id = ?",
    "actor-failed",
  ).orElseThrow();
  assert.equal(state.state_kind, "failed");
  const event = database.get<{ event_json: string }>(
    "SELECT event_json FROM actor_event WHERE actor_id = ? ORDER BY sequence DESC LIMIT 1",
    "actor-failed",
  ).orElseThrow();
  const payload = JSON.parse(event.event_json) as { to: { kind: string }; cause: { kind: string } };
  assert.equal(payload.to.kind, "failed");
  assert.equal(payload.cause.kind, "external-error");
});

test("create does not activate an agent when initial persistence fails", async () => {
  using database = new Database(":memory:");
  let calls = 0;
  const factory: AgentSessionFactory<object> = {
    async create() {
      calls += 1;
      return {};
    },
  };
  const manager = new ActorManager(database, factory);

  await assert.rejects(
    manager.create({
      id: "actor-no-schema",
      name: "No schema",
      role: "designer",
      workspace: "/work/project",
    }),
  );
  assert.equal(calls, 0);
});

test("dispose releases active agents, is idempotent, and rejects new actors", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  let disposeCalls = 0;
  const factory: AgentSessionFactory<{ dispose(): void }> = {
    async create() {
      return {
        dispose() {
          disposeCalls += 1;
        },
      };
    },
  };
  const manager = new ActorManager(database, factory);
  await manager.create({
    id: "actor-disposable",
    name: "Disposable",
    role: "devops_engineer",
    workspace: "/work/project",
  });

  manager.dispose();
  manager.dispose();
  assert.equal(disposeCalls, 1);
  await assert.rejects(
    manager.create({
      id: "actor-after-dispose",
      name: "Rejected",
      role: "designer",
      workspace: "/work/project",
    }),
    /ActorManager is disposed/,
  );
});

test("get returns the persisted view including the latest event timestamp", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() {
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({
    id: "actor-view",
    name: "View",
    role: "qa_engineer",
    workspace: "/work/project",
  });

  const view = manager.get("actor-view").orElseThrow();
  assert.equal(view.id, "actor-view");
  assert.equal(view.config.name, "View");
  assert.equal(view.state.kind, "ready");
  assert.ok(view.lastEventAt !== null);
  assert.equal(manager.get("does-not-exist").isPresent(), false);
});

test("list returns views with the latest state for every persisted actor and supports filters", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() {
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-1", name: "A", role: "designer", workspace: "/w" });
  await manager.create({ id: "a-2", name: "B", role: "designer", workspace: "/w" });
  await manager.create({ id: "a-3", name: "C", role: "product_manager", workspace: "/other" });

  const all = manager.list();
  assert.deepEqual(all.map((v) => v.id).sort(), ["a-1", "a-2", "a-3"]);
  for (const view of all) {
    assert.equal(view.state.kind, "ready");
    assert.ok(view.lastEventAt !== null);
    assert.equal(view.config.policy.kind, "never");
  }

  assert.deepEqual(
    manager.list({ role: "designer" }).map((v) => v.id).sort(),
    ["a-1", "a-2"],
  );
  assert.deepEqual(
    manager.list({ stateKind: "ready" }).map((v) => v.id).sort(),
    ["a-1", "a-2", "a-3"],
  );
  assert.deepEqual(
    manager.list({ workspace: "/other" }).map((v) => v.id),
    ["a-3"],
  );
});

test("create persists a custom policy and reads it back through get and list", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() {
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({
    id: "a-policy",
    name: "P",
    role: "designer",
    workspace: "/w",
    policy: { kind: "on-failure", maxRetries: 3, backoffMs: 1_000, jitter: true },
  });

  assert.deepEqual(manager.get("a-policy").get().config.policy, {
    kind: "on-failure",
    maxRetries: 3,
    backoffMs: 1_000,
    jitter: true,
  });
  assert.equal(manager.list()[0]?.config.policy.kind, "on-failure");
});

test("create defaults the policy to DEFAULT_RESTART_POLICY (never) when omitted", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() {
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-default", name: "D", role: "designer", workspace: "/w" });
  assert.deepEqual(manager.get("a-default").get().config.policy, { kind: "never" });
});

test("eventsOf returns events in order with the configured cap", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() {
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-events", name: "E", role: "designer", workspace: "/w" });

  const all = manager.eventsOf("a-events");
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((e) => e.kind), ["state-changed", "state-changed"]);

  const afterFirst = manager.eventsOf("a-events", 1);
  assert.equal(afterFirst.length, 1);
  assert.equal(afterFirst[0]?.kind, "state-changed");

  const limited = manager.eventsOf("a-events", 0, 1);
  assert.equal(limited.length, 1);

  assert.equal(manager.eventsOf("does-not-exist").length, 0);
});

test("reload returns an empty report when the database is empty", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() {
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });

  const report = await manager.reload();
  assert.deepEqual(report, {
    resumed: [],
    quarantined: [],
    orphans: [],
    missingConfigs: [],
  });
});

test("reload resumes a ready actor and records a recovery event", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  let factoryCalls = 0;
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() {
      factoryCalls += 1;
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-ready", name: "Ready", role: "designer", workspace: "/w" });
  // Simulate a server restart by throwing away the in-memory projection and
  // building a fresh manager on the same database.
  factoryCalls = 0;
  const restarted = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  const report = await restarted.reload();
  assert.deepEqual(report.resumed, ["a-ready"]);
  assert.deepEqual(report.quarantined, []);
  assert.equal(factoryCalls, 1);

  const last = database.get<{ event_json: string }>(
    "SELECT event_json FROM actor_event WHERE actor_id = ? ORDER BY sequence DESC LIMIT 1",
    "a-ready",
  ).orElseThrow();
  const payload = JSON.parse(last.event_json) as { to: { kind: string }; cause: { kind: string } };
  assert.equal(payload.to.kind, "ready");
  assert.equal(payload.cause.kind, "recovery");
});

test("reload quarantines non-ready actors and does not reactivate them", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  let factoryCalls = 0;
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() {
      factoryCalls += 1;
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-paused", name: "Paused", role: "designer", workspace: "/w" });
  writeState(database, "a-paused", { kind: "paused", reason: "user", since: Date.now() });
  await manager.create({ id: "a-failed", name: "Failed", role: "designer", workspace: "/w" });
  writeState(database, "a-failed", {
    kind: "failed",
    error: { category: "transient", message: "boom", diagnostic: null },
    since: Date.now(),
  });
  await manager.create({ id: "a-done", name: "Done", role: "designer", workspace: "/w" });
  writeState(database, "a-done", { kind: "terminated", clean: true, at: Date.now() });

  factoryCalls = 0;
  const report = await manager.reload();
  assert.deepEqual(report.resumed, []);
  assert.equal(factoryCalls, 0);
  const ids = report.quarantined.map((q) => q.id).sort();
  assert.deepEqual(ids, ["a-failed", "a-paused"]);
  assert.equal(
    report.quarantined.find((q) => q.id === "a-paused")?.reason,
    "user-paused on restart",
  );
  assert.ok(
    report.quarantined.find((q) => q.id === "a-failed")?.reason?.startsWith("previously failed:"),
  );
});

test("reload surfaces orphan events and configs without events", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() {
      return { kind: "fake" };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });

  // An orphan event whose actor_id has no matching config.
  database.run(
    `INSERT INTO actor_event (actor_id, sequence, event_id, event_json, created_at)
     VALUES (?, 1, ?, ?, ?)`,
    "orphan-id",
    "evt-orphan",
    JSON.stringify({
      kind: "state-changed",
      from: { kind: "created" },
      to: { kind: "ready" },
      at: Date.now(),
      cause: { kind: "recovery" },
    }),
    Date.now(),
  );
  // A config with no events at all.
  database.run(
    `INSERT INTO actor_config (id, config_json, state_kind, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    "missing-events",
    JSON.stringify({
      id: "missing-events",
      name: "Lost",
      role: "designer",
      workspace: "/w",
      sessionFile: "/tmp/x",
      tools: [],
      promptTemplateRef: "default",
      limits: {
        maxWallClockMs: 1,
        maxConcurrentTasks: 1,
        maxMemoryMb: null,
        maxTokensPerHour: null,
      },
      createdAt: Date.now(),
    }),
    "ready",
    Date.now(),
    Date.now(),
  );

  const report = await manager.reload();
  assert.deepEqual(report.orphans, ["orphan-id"]);
  assert.deepEqual(report.missingConfigs, ["missing-events"]);
});

/**
 * Writes a state-changed event for an existing actor and updates the
 * `state_kind` cache so subsequent reads return the desired state. Used to
 * set up recovery scenarios that the public `create` flow does not produce.
 */
function writeState(
  database: Database,
  actorId: string,
  to: { kind: string } & Record<string, unknown>,
): void {
  const at = Date.now();
  const prev = databaseLastState(database, actorId);
  const nextSequence = database
    .get<{ next: number }>(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM actor_event WHERE actor_id = ?",
      actorId,
    )
    .orElseThrow().next;
  database.run(
    `INSERT INTO actor_event (actor_id, sequence, event_id, event_json, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    actorId,
    nextSequence,
    `evt-${nextSequence}-${actorId}`,
    JSON.stringify({ kind: "state-changed", from: prev, to, at, cause: { kind: "recovery" } }),
    at,
  );
  database.run(
    "UPDATE actor_config SET state_kind = ?, updated_at = ? WHERE id = ?",
    to.kind,
    at,
    actorId,
  );
}

function databaseLastState(
  database: Database,
  actorId: string,
): { kind: string } & Record<string, unknown> {
  const row = database
    .get<{ event_json: string }>(
      "SELECT event_json FROM actor_event WHERE actor_id = ? ORDER BY sequence DESC LIMIT 1",
      actorId,
    )
    .orElseThrow();
  return JSON.parse(row.event_json).to as { kind: string } & Record<string, unknown>;
}

test("send(pause) transitions a ready actor to paused and publishes the event", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() { return { kind: "fake" }; },
  };
  const publisher = new InMemoryEventPublisher();
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
    publisher,
  });
  await manager.create({ id: "a-pause", name: "P", role: "designer", workspace: "/w" });
  publisher.publish.length; // touch — to satisfy unused checks
  const seen: PublishedEvent[] = [];
  publisher.subscribeAll((e) => seen.push(e));

  manager.send("a-pause", { kind: "pause", reason: "lunch" });

  const state = manager.get("a-pause").get().state;
  assert.equal(state.kind, "paused");
  if (state.kind === "paused") assert.equal(state.reason, "lunch");
  const last = seen.at(-1);
  assert.equal(last?.event.kind, "state-changed");
  if (last?.event.kind === "state-changed") {
    assert.equal(last.event.to.kind, "paused");
    assert.deepEqual(last.event.cause, { kind: "command", command: "pause" });
  }
});

test("send(resume) transitions a paused actor to ready", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() { return { kind: "fake" }; },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-resume", name: "R", role: "designer", workspace: "/w" });
  manager.send("a-resume", { kind: "pause", reason: "x" });

  manager.send("a-resume", { kind: "resume" });
  assert.equal(manager.get("a-resume").get().state.kind, "ready");
});

test("send(restart) jumps a paused actor back to ready", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() { return { kind: "fake" }; },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-restart", name: "R", role: "designer", workspace: "/w" });
  manager.send("a-restart", { kind: "pause", reason: "x" });
  manager.send("a-restart", { kind: "restart", reason: "memory" });
  assert.equal(manager.get("a-restart").get().state.kind, "ready");
});

test("send(quarantine) moves a ready actor to quarantined", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() { return { kind: "fake" }; },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-quar", name: "Q", role: "designer", workspace: "/w" });
  manager.send("a-quar", { kind: "quarantine", reason: "stuck" });
  const state = manager.get("a-quar").get().state;
  assert.equal(state.kind, "quarantined");
  if (state.kind === "quarantined") assert.equal(state.reason, "stuck");
});

test("send(terminate) disposes the agent and removes the actor from the in-memory map", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  let disposed = 0;
  const factory: AgentSessionFactory<{ dispose(): void }> = {
    async create() {
      return { dispose() { disposed += 1; } };
    },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-term", name: "T", role: "designer", workspace: "/w" });
  manager.send("a-term", { kind: "terminate", clean: true });
  assert.equal(manager.get("a-term").get().state.kind, "terminated");
  assert.equal(disposed, 1);
});

test("send rejects commands against unknown actors with actor-not-found", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() { return { kind: "fake" }; },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  let caught: unknown;
  try {
    manager.send("nope", { kind: "resume" });
  } catch (cause) { caught = cause; }
  assert.ok(caught instanceof ManagerError);
  assert.equal((caught as ManagerError).code, "actor-not-found");
});

test("send rejects invalid transitions with invalid-state-transition", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() { return { kind: "fake" }; },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-bad", name: "B", role: "designer", workspace: "/w" });
  // ready actor cannot be resumed
  let caught: unknown;
  try {
    manager.send("a-bad", { kind: "resume" });
  } catch (cause) { caught = cause; }
  assert.ok(caught instanceof ManagerError);
  assert.equal((caught as ManagerError).code, "invalid-state-transition");
});

test("send rejects all commands once the actor is terminated", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ dispose(): void }> = {
    async create() { return { dispose() {} }; },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-done", name: "D", role: "designer", workspace: "/w" });
  manager.send("a-done", { kind: "terminate", clean: true });
  let caught: unknown;
  try {
    manager.send("a-done", { kind: "pause", reason: "x" });
  } catch (cause) { caught = cause; }
  assert.ok(caught instanceof ManagerError);
  assert.equal((caught as ManagerError).code, "invalid-state-transition");
});

test("send throws not-implemented for unhandled commands", async () => {
  using database = new Database(":memory:");
  database.exec(ACTOR_SCHEMA);
  const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
    async create() { return { kind: "fake" }; },
  };
  const manager = new ActorManager(database, factory, {
    sessionDirectory: "/tmp/sinan-test-sessions",
  });
  await manager.create({ id: "a-ni", name: "N", role: "designer", workspace: "/w" });
  let caught: unknown;
  try {
    manager.send("a-ni", { kind: "assign", taskId: "t", leaseId: "l" });
  } catch (cause) { caught = cause; }
  assert.ok(caught instanceof ManagerError);
  assert.equal((caught as ManagerError).code, "not-implemented");
});
