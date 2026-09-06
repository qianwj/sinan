import assert from "node:assert/strict";
import { test } from "node:test";
import { ActorManager, type AgentSessionFactory } from "../actors/index.js";
import { Database } from "../persistence/database.js";
import { ErrorMapper } from "./error_mapper.js";
import { HealthRoutes } from "./health.js";
import { HttpServer } from "./http_server.js";
import { Router } from "./router.js";

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

test("GET /api/health returns 200 with status, version, and zero counts", async () => {
    const database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
        async create() {
            return { kind: "fake" };
        },
    };
    const manager = new ActorManager(database, factory, {
        sessionDirectory: "/tmp/sinan-test-sessions",
    });
    const router = new Router(new HealthRoutes(manager).routes, new ErrorMapper());
    const server = new HttpServer(router, 0);
    await server.start();
    try {
        const res = await fetch(`http://127.0.0.1:${server.port}/api/health`);
        assert.equal(res.status, 200);
        const body = await res.json() as { status: string; version: string; actorCount: number; quarantinedCount: number };
        assert.equal(body.status, "ok");
        assert.equal(body.version, "0.0.1");
        assert.equal(body.actorCount, 0);
        assert.equal(body.quarantinedCount, 0);
    } finally {
        await server.stop();
        database.close();
    }
});

test("GET /api/health reflects actorCount and quarantinedCount from the manager", async () => {
    const database = new Database(":memory:");
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

    // Move a-2 to quarantined through the persistence layer.
    database.run(
        `UPDATE actor_config SET state_kind = 'quarantined', updated_at = ? WHERE id = ?`,
        Date.now(),
        "a-2",
    );

    const router = new Router(new HealthRoutes(manager).routes, new ErrorMapper());
    const server = new HttpServer(router, 0);
    await server.start();
    try {
        const address = server["server"]?.address();
        const port = typeof address === "object" && address !== null ? address.port : 0;
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        const body = await res.json() as { actorCount: number; quarantinedCount: number };
        assert.equal(body.actorCount, 2);
        assert.equal(body.quarantinedCount, 1);
    } finally {
        await server.stop();
        database.close();
    }
});
