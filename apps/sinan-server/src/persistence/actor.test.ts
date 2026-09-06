import assert from "node:assert/strict";
import { test } from "node:test";
import type {
    ActorConfig,
    ActorId,
    ActorState,
    EventCause,
    Timestamp,
} from "sinan-core";
import {
    ActorConfigRepository,
    ActorEventRepository,
} from "./actor.js";
import { Database } from "./database.js";

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

function buildConfig(id: ActorId, overrides: Partial<ActorConfig> = {}): ActorConfig {
    return {
        id,
        name: `name-${id}`,
        role: "designer",
        workspace: "/work/project",
        sessionFile: `/tmp/sessions/${id}/session.jsonl`,
        tools: ["read"],
        promptTemplateRef: "default",
        limits: {
            maxWallClockMs: 60_000,
            maxConcurrentTasks: 1,
            maxMemoryMb: null,
            maxTokensPerHour: null,
        },
        policy: { kind: "never" },
        createdAt: 1_700_000_000_000,
        ...overrides,
    };
}

function makeEvent(actorId: ActorId, sequence: number, to: ActorState, at: Timestamp): {
    actor_id: string;
    sequence: number;
    event_id: string;
    event_json: string;
    created_at: number;
} {
    const event: Record<string, unknown> = {
        kind: "state-changed",
        from: { kind: "created" },
        to,
        at,
        cause: { kind: "command", command: "test" } satisfies EventCause,
    };
    return {
        actor_id: actorId,
        sequence,
        event_id: `evt-${actorId}-${sequence}`,
        event_json: JSON.stringify(event),
        created_at: at,
    };
}

test("ActorConfigRepository.findAll parses config_json into typed configs", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const repo = new ActorConfigRepository(database);

    repo.create(buildConfig("a-1"), { kind: "ready" }, 1_000);
    repo.create(buildConfig("a-2", { role: "qa_engineer" }), { kind: "ready" }, 2_000);

    const all = repo.findAll();
    assert.equal(all.length, 2);
    assert.deepEqual(
        all.map((c) => c.id).sort(),
        ["a-1", "a-2"],
    );
    assert.equal(all.find((c) => c.id === "a-1")?.role, "designer");
    assert.equal(all.find((c) => c.id === "a-2")?.role, "qa_engineer");
    assert.equal(all[0]?.sessionFile, "/tmp/sessions/a-1/session.jsonl");
});

test("ActorConfigRepository.findById returns empty when no row matches", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const repo = new ActorConfigRepository(database);

    repo.create(buildConfig("a-1"), { kind: "ready" }, 1_000);
    assert.equal(repo.findById("a-1").isPresent(), true);
    assert.equal(repo.findById("missing").isPresent(), false);
});

test("ActorConfigRepository.updateOne writes state_kind and bumps updated_at", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const repo = new ActorConfigRepository(database);

    repo.create(buildConfig("a-1"), { kind: "ready" }, 1_000);
    repo.updateOne("a-1", { kind: "paused", reason: "user", since: 2_000 }, 2_000);

    const row = database
        .get<{ state_kind: string; updated_at: number; created_at: number }>(
            "SELECT state_kind, updated_at, created_at FROM actor_config WHERE id = ?",
            "a-1",
        )
        .orElseThrow();
    assert.equal(row.state_kind, "paused");
    assert.equal(row.updated_at, 2_000);
    assert.equal(row.created_at, 1_000);
});

test("ActorConfigRepository.findAllSummaries joins role/workspace and computes lastEventAt", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const configs = new ActorConfigRepository(database);
    const events = new ActorEventRepository(database);

    configs.create(buildConfig("a-1"), { kind: "ready" }, 1_000);
    configs.create(buildConfig("a-2", { role: "qa_engineer" }), { kind: "paused", reason: "x", since: 1_500 }, 1_500);
    configs.create(buildConfig("a-3", { workspace: "/other" }), { kind: "ready" }, 2_000);
    events.recordStateChanged("a-1", { kind: "created" }, { kind: "ready" }, { kind: "command", command: "init" }, 1_100);
    events.recordStateChanged("a-3", { kind: "created" }, { kind: "ready" }, { kind: "command", command: "init" }, 2_100);

    const all = configs.findAllSummaries();
    assert.equal(all.length, 3);
    const byId = Object.fromEntries(all.map((s) => [s.id, s]));
    assert.equal(byId["a-1"]?.stateKind, "ready");
    assert.equal(byId["a-1"]?.role, "designer");
    assert.equal(byId["a-1"]?.lastEventAt, 1_100);
    assert.equal(byId["a-2"]?.stateKind, "paused");
    assert.equal(byId["a-2"]?.lastEventAt, null);
    assert.equal(byId["a-3"]?.workspace, "/other");

    assert.deepEqual(
        configs.findAllSummaries({ role: "qa_engineer" }).map((s) => s.id),
        ["a-2"],
    );
    assert.deepEqual(
        configs.findAllSummaries({ stateKind: "ready" }).map((s) => s.id).sort(),
        ["a-1", "a-3"],
    );
    assert.deepEqual(
        configs.findAllSummaries({ workspace: "/other" }).map((s) => s.id),
        ["a-3"],
    );
});

test("ActorEventRepository.recordStateChanged increments sequence and returns it", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const events = new ActorEventRepository(database);

    const cause: EventCause = { kind: "command", command: "init" };
    const r1 = events.recordStateChanged("a-1", { kind: "created" }, { kind: "ready" }, cause, 1_000);
    const r2 = events.recordStateChanged("a-1", { kind: "ready" }, { kind: "ready" }, cause, 2_000);
    const r3 = events.recordStateChanged("a-2", { kind: "created" }, { kind: "ready" }, cause, 1_500);

    assert.equal(r1.sequence, 1);
    assert.equal(r2.sequence, 2);
    assert.equal(r3.sequence, 1, "sequence is per-actor");
    assert.notEqual(r1.eventId, r2.eventId, "each event gets a unique id");
    assert.notEqual(r1.eventId, r3.eventId);
});

test("ActorEventRepository.findLatest returns the parsed state and timestamp of the latest event", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const events = new ActorEventRepository(database);

    events.recordStateChanged(
        "a-1",
        { kind: "created" },
        { kind: "ready" },
        { kind: "command", command: "init" },
        1_000,
    );
    events.recordStateChanged(
        "a-1",
        { kind: "ready" },
        { kind: "paused", reason: "user", since: 2_000 },
        { kind: "command", command: "pause" },
        2_000,
    );

    const latest = events.findLatest("a-1").orElseThrow();
    assert.equal(latest.sequence, 2);
    assert.equal(latest.state.kind, "paused");
    assert.equal(latest.at, 2_000);
    assert.equal(events.findLatest("missing").isPresent(), false);
});

test("ActorEventRepository.listSince orders by sequence and clamps the limit", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const events = new ActorEventRepository(database);

    for (let i = 1; i <= 5; i += 1) {
        events.recordStateChanged(
            "a-1",
            { kind: "ready" },
            { kind: "ready" },
            { kind: "command", command: `tick-${i}` },
            1_000 + i,
        );
    }

    assert.equal(events.listSince("a-1", 0, 10).length, 5);
    assert.equal(events.listSince("a-1", 2, 10).length, 3, "exclusive of sequence 2");
    assert.equal(events.listSince("a-1", 0, 2).length, 2, "limit clamps result count");
    assert.equal(events.listSince("a-1", 0, 0).length, 0, "non-positive limit yields nothing");
});

test("ActorEventRepository.findOrphanActorIds excludes configured actors", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const events = new ActorEventRepository(database);

    events.recordStateChanged("a-1", { kind: "created" }, { kind: "ready" }, { kind: "command", command: "x" }, 1_000);
    events.recordStateChanged("orphan", { kind: "created" }, { kind: "ready" }, { kind: "command", command: "y" }, 1_100);

    assert.deepEqual(
        events.findOrphanActorIds(new Set(["a-1"])),
        ["orphan"],
    );
    assert.deepEqual(
        events.findOrphanActorIds(new Set()).sort(),
        ["a-1", "orphan"],
    );
});

test("ActorConfigRepository.findAllViews returns config + latest state + timestamp", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const configs = new ActorConfigRepository(database);
    const events = new ActorEventRepository(database);

    configs.create(buildConfig("a-1"), { kind: "ready" }, 1_000);
    configs.create(buildConfig("a-2", { role: "qa_engineer" }), { kind: "ready" }, 2_000);
    events.recordStateChanged("a-1", { kind: "created" }, { kind: "ready" }, { kind: "command", command: "init" }, 1_100);
    events.recordStateChanged("a-2", { kind: "created" }, { kind: "ready" }, { kind: "command", command: "init" }, 2_100);
    events.recordStateChanged(
        "a-2",
        { kind: "ready" },
        { kind: "paused", reason: "user", since: 2_200 },
        { kind: "command", command: "pause" },
        2_200,
    );

    const all = configs.findAllViews();
    assert.equal(all.length, 2);
    const byId = Object.fromEntries(all.map((v) => [v.id, v]));
    assert.equal(byId["a-1"]?.config.name, "name-a-1");
    assert.equal(byId["a-1"]?.state.kind, "ready");
    assert.equal(byId["a-1"]?.lastEventAt, 1_100);
    assert.equal(byId["a-1"]?.config.policy.kind, "never");
    assert.equal(byId["a-2"]?.state.kind, "paused");
    assert.equal(byId["a-2"]?.lastEventAt, 2_200);
});

test("ActorConfigRepository.findAllViews applies role / stateKind / workspace filters", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const configs = new ActorConfigRepository(database);
    const events = new ActorEventRepository(database);

    configs.create(buildConfig("a-1"), { kind: "ready" }, 1_000);
    configs.create(buildConfig("a-2", { role: "qa_engineer" }), { kind: "ready" }, 2_000);
    configs.create(buildConfig("a-3", { workspace: "/other" }), { kind: "ready" }, 3_000);
    for (const id of ["a-1", "a-2", "a-3"]) {
        events.recordStateChanged(id, { kind: "created" }, { kind: "ready" }, { kind: "command", command: "init" }, 1_000);
    }

    assert.deepEqual(
        configs.findAllViews({ role: "qa_engineer" }).map((v) => v.id),
        ["a-2"],
    );
    assert.deepEqual(
        configs.findAllViews({ workspace: "/other" }).map((v) => v.id),
        ["a-3"],
    );
});

test("ActorConfigRepository.findAllViews excludes configs with no events", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const configs = new ActorConfigRepository(database);

    configs.create(buildConfig("a-1"), { kind: "ready" }, 1_000);
    configs.create(buildConfig("a-2"), { kind: "ready" }, 2_000);

    // Only a-1 has an event; a-2 should be excluded.
    database.run(
        `INSERT INTO actor_event (actor_id, sequence, event_id, event_json, created_at)
         VALUES (?, 1, ?, ?, ?)`,
        "a-1",
        "evt-1",
        JSON.stringify({
            kind: "state-changed",
            from: { kind: "created" },
            to: { kind: "ready" },
            at: 1_000,
            cause: { kind: "command", command: "init" },
        }),
        1_000,
    );
    const views = configs.findAllViews();
    assert.equal(views.length, 1);
    assert.equal(views[0]?.id, "a-1");
});

test("parseConfigRow defaults policy for legacy rows written before the field existed", () => {
    using database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const configs = new ActorConfigRepository(database);

    database.run(
        `INSERT INTO actor_config (id, config_json, state_kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        "legacy",
        JSON.stringify({
            id: "legacy",
            name: "Old",
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
            // no `policy` field
            createdAt: 1_000,
        }),
        "ready",
        1_000,
        1_000,
    );
    const view = configs.findById("legacy").orElseThrow();
    assert.deepEqual(view.policy, { kind: "never" });
});
