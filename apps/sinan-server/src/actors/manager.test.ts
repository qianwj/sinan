import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ActorManager,
  type AgentSessionFactory,
  type CreateAgentSessionOptions,
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
