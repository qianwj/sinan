import assert from "node:assert/strict";
import { test } from "node:test";
import { ActorManager, type AgentSessionFactory } from "../actors/index.js";
import { Database } from "../persistence/database.js";
import { ActorRoutes } from "./actors.js";
import { ErrorMapper } from "./error_mapper.js";
import { HealthRoutes } from "./health.js";
import { HttpServer } from "./http_server.js";
import { IdempotencyStore } from "./idempotency.js";
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

interface JsonResponse {
    status: number;
    body: unknown;
}

async function setup(): Promise<{ server: HttpServer; baseUrl: string; cleanup: () => Promise<void> }> {
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
    const idempotency = new IdempotencyStore();
    const router = new Router(
        [
            ...new ActorRoutes(manager, idempotency).routes,
            ...new HealthRoutes(manager).routes,
        ],
        new ErrorMapper(),
    );
    const server = new HttpServer(router, 0);
    await server.start();
    const baseUrl = `http://127.0.0.1:${server.port}`;
    return {
        server,
        baseUrl,
        cleanup: async () => {
            await server.stop();
            database.close();
        },
    };
}

async function request(baseUrl: string, path: string, init: RequestInit = {}): Promise<JsonResponse> {
    const res = await fetch(`${baseUrl}${path}`, init);
    const text = await res.text();
    const body = text.length === 0 ? null : JSON.parse(text);
    return { status: res.status, body };
}

test("POST /api/actors creates an actor and returns 201 with policy", async () => {
    const { server, baseUrl, cleanup } = await setup();
    try {
        const response = await request(baseUrl, "/api/actors", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                name: "Builder",
                role: "development_engineer",
                workspace: "/w",
                policy: { kind: "on-failure" },
            }),
        });
        assert.equal(response.status, 201);
        const body = response.body as { id: string; name: string; policy: { kind: string } };
        assert.equal(body.name, "Builder");
        assert.equal(body.policy.kind, "on-failure");
    } finally {
        await cleanup();
    }
});

test("POST /api/actors with Idempotency-Key replays the same response", async () => {
    const { server, baseUrl, cleanup } = await setup();
    try {
        const headers = {
            "content-type": "application/json",
            "idempotency-key": "key-1",
        };
        const body = JSON.stringify({ name: "Replayer", role: "designer", workspace: "/w" });
        const first = await request(baseUrl, "/api/actors", { method: "POST", headers, body });
        assert.equal(first.status, 201);
        const firstId = (first.body as { id: string }).id;

        // Replay the same key with a different body — the server should return
        // the original response, not a new actor.
        const second = await request(baseUrl, "/api/actors", {
            method: "POST",
            headers,
            body: JSON.stringify({ name: "Other", role: "qa_engineer", workspace: "/elsewhere" }),
        });
        assert.equal(second.status, 201);
        const secondId = (second.body as { id: string }).id;
        assert.equal(secondId, firstId, "replay returns the original actor id");
    } finally {
        await cleanup();
    }
});

test("POST /api/actors validates inputs and returns 400 invalid-input", async () => {
    const { server, baseUrl, cleanup } = await setup();
    try {
        const response = await request(baseUrl, "/api/actors", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Bad", role: "designer" }),
        });
        assert.equal(response.status, 400);
        const body = response.body as { code: string };
        assert.equal(body.code, "invalid-input");
    } finally {
        await cleanup();
    }
});

test("GET /api/actors returns the list wrapped in { actors }", async () => {
    const { server, baseUrl, cleanup } = await setup();
    try {
        await request(baseUrl, "/api/actors", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "A", role: "designer", workspace: "/w" }),
        });
        await request(baseUrl, "/api/actors", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "B", role: "qa_engineer", workspace: "/w" }),
        });
        const list = await request(baseUrl, "/api/actors");
        assert.equal(list.status, 200);
        const body = list.body as { actors: Array<{ id: string; name: string; policy: { kind: string } }> };
        assert.equal(body.actors.length, 2);
        assert.deepEqual(body.actors.map((a) => a.name).sort(), ["A", "B"]);
        for (const actor of body.actors) {
            assert.equal(actor.policy.kind, "never");
        }
    } finally {
        await cleanup();
    }
});

test("GET /api/actors supports role and stateKind filters", async () => {
    const { server, baseUrl, cleanup } = await setup();
    try {
        await request(baseUrl, "/api/actors", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "A", role: "designer", workspace: "/w" }),
        });
        await request(baseUrl, "/api/actors", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "B", role: "qa_engineer", workspace: "/w" }),
        });
        const designers = await request(baseUrl, "/api/actors?role=designer");
        const body = designers.body as { actors: Array<{ name: string }> };
        assert.equal(body.actors.length, 1);
        assert.equal(body.actors[0]?.name, "A");
    } finally {
        await cleanup();
    }
});

test("GET /api/actors/:id returns the actor or 404 not-found", async () => {
    const { server, baseUrl, cleanup } = await setup();
    try {
        const create = await request(baseUrl, "/api/actors", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Detail", role: "designer", workspace: "/w" }),
        });
        const id = (create.body as { id: string }).id;
        const detail = await request(baseUrl, `/api/actors/${id}`);
        assert.equal(detail.status, 200);
        const detailBody = detail.body as { id: string; state: { kind: string } };
        assert.equal(detailBody.id, id);
        assert.equal(detailBody.state.kind, "ready");

        const missing = await request(baseUrl, "/api/actors/does-not-exist");
        assert.equal(missing.status, 404);
        const missingBody = missing.body as { code: string };
        assert.equal(missingBody.code, "not-found");
    } finally {
        await cleanup();
    }
});

test("GET /api/actors/:id/events returns the event log wrapped in { events }", async () => {
    const { server, baseUrl, cleanup } = await setup();
    try {
        const create = await request(baseUrl, "/api/actors", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Logger", role: "designer", workspace: "/w" }),
        });
        const id = (create.body as { id: string }).id;
        const events = await request(baseUrl, `/api/actors/${id}/events`);
        assert.equal(events.status, 200);
        const body = events.body as { events: Array<{ kind: string }> };
        assert.equal(body.events.length, 2, "create writes two state-changed events");
        assert.deepEqual(body.events.map((e) => e.kind), ["state-changed", "state-changed"]);
    } finally {
        await cleanup();
    }
});

test("GET /api/actors/:id/events?since=1 returns only events past the cursor", async () => {
    const { server, baseUrl, cleanup } = await setup();
    try {
        const create = await request(baseUrl, "/api/actors", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name: "Cursored", role: "designer", workspace: "/w" }),
        });
        const id = (create.body as { id: string }).id;
        const events = await request(baseUrl, `/api/actors/${id}/events?since=1`);
        const body = events.body as { events: unknown[] };
        assert.equal(body.events.length, 1);
    } finally {
        await cleanup();
    }
});
