import assert from "node:assert/strict";
import { test } from "node:test";
import { ActorManager, InMemoryEventPublisher, type AgentSessionFactory } from "../actors/index.js";
import { Database } from "../persistence/database.js";
import { ActorConfigRepository, ActorEventRepository } from "../persistence/actor.js";
import { ActorRoutes } from "./actors.js";
import { ErrorMapper } from "./error_mapper.js";
import { EventStreamHandler } from "./event_stream.js";
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

interface Setup {
    server: HttpServer;
    publisher: InMemoryEventPublisher;
    manager: ActorManager<{ readonly kind: "fake" }>;
    baseUrl: string;
    cleanup: () => Promise<void>;
}

async function setup(): Promise<Setup> {
    const database = new Database(":memory:");
    database.exec(ACTOR_SCHEMA);
    const factory: AgentSessionFactory<{ readonly kind: "fake" }> = {
        async create() {
            return { kind: "fake" };
        },
    };
    const publisher = new InMemoryEventPublisher();
    const manager = new ActorManager(database, factory, {
        sessionDirectory: "/tmp/sinan-test-sessions",
        publisher,
    });
    const idempotency = new IdempotencyStore();
    const configRepository = new ActorConfigRepository(database);
    const eventRepository = new ActorEventRepository(database);
    const router = new Router(
        [
            ...new ActorRoutes(manager, idempotency).routes,
            ...new HealthRoutes(manager).routes,
            ...new EventStreamHandler(publisher, configRepository, eventRepository).routes,
        ],
        new ErrorMapper(),
    );
    const server = new HttpServer(router, 0);
    await server.start();
    return {
        server,
        publisher,
        manager,
        baseUrl: `http://127.0.0.1:${server.port}`,
        cleanup: async () => {
            await server.stop();
            database.close();
        },
    };
}

interface ParsedFrame {
    id: string | null;
    event: string | null;
    data: unknown;
}

/** Reads from a fetch response body until `predicate` matches a frame or
 *  `timeoutMs` elapses. Used by the SSE tests to assert the next frame
 *  is the one we want. The same reader is reused across calls so
 *  successive reads stay positioned on the live stream. */
async function readFrame(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    predicate: (frame: ParsedFrame) => boolean,
    timeoutMs = 2_000,
): Promise<ParsedFrame> {
    const decoder = new TextDecoder();
    let buffer = "";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const { value, done } = await Promise.race([
            reader.read(),
            new Promise<{ value: undefined; done: true }>((resolve) => {
                setTimeout(() => resolve({ value: undefined, done: true }), Math.max(0, deadline - Date.now()));
            }),
        ]);
        if (done) break;
        if (value === undefined) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = parseFrames(buffer);
        for (const frame of frames) {
            if (predicate(frame)) {
                return frame;
            }
        }
        // Keep the trailing partial frame in the buffer.
        const lastBoundary = buffer.lastIndexOf("\n\n");
        if (lastBoundary >= 0) {
            buffer = buffer.slice(lastBoundary + 2);
        }
    }
    throw new Error(`Timed out waiting for a matching SSE frame; got: ${buffer}`);
}

function parseFrames(buffer: string): ParsedFrame[] {
    const out: ParsedFrame[] = [];
    const chunks = buffer.split("\n\n");
    for (const chunk of chunks) {
        if (chunk.trim().length === 0) continue;
        const lines = chunk.split("\n");
        const frame: { id: string | null; event: string | null; data: unknown } = {
            id: null,
            event: null,
            data: null,
        };
        const dataLines: string[] = [];
        for (const line of lines) {
            if (line.startsWith(":")) continue;
            const colon = line.indexOf(":");
            if (colon < 0) continue;
            const field = line.slice(0, colon);
            const value = line.slice(colon + 1).trimStart();
            switch (field) {
                case "id":
                    frame.id = value;
                    break;
                case "event":
                    frame.event = value;
                    break;
                case "data":
                    dataLines.push(value);
                    break;
            }
        }
        frame.data = dataLines.length > 0 ? JSON.parse(dataLines.join("\n")) : null;
        out.push(frame);
    }
    return out;
}

test("GET /events returns 200 with text/event-stream and replays prior state-changed events", async () => {
    const { manager, baseUrl, cleanup } = await setup();
    try {
        await manager.create({ id: "a-replay", name: "R", role: "designer", workspace: "/w" });
        const res = await fetch(`${baseUrl}/events`);
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
        const reader = res.body?.getReader();
        if (reader === undefined) throw new Error("response body is not a stream");
        const ready = await readFrame(reader, (f) => {
            if (f.event !== "state-changed") return false;
            const event = f.data as { to: { kind: string } };
            return event.to.kind === "ready";
        });
        const event = ready.data as { kind: string; to: { kind: string } };
        assert.equal(event.kind, "state-changed");
        assert.equal(event.to.kind, "ready", "replays the latest persisted state");
        reader.cancel().catch(() => undefined);
    } finally {
        await cleanup();
    }
});

test("GET /events delivers live state-changed events as commands transition the actor", async () => {
    const { manager, baseUrl, cleanup } = await setup();
    try {
        await manager.create({ id: "a-live", name: "L", role: "designer", workspace: "/w" });
        const res = await fetch(`${baseUrl}/events`);
        const reader = res.body?.getReader();
        if (reader === undefined) throw new Error("response body is not a stream");
        // Drain the replay first so the next state-changed frame is the live one.
        await readFrame(reader, (f) => {
            if (f.event !== "state-changed") return false;
            const event = f.data as { to: { kind: string } };
            return event.to.kind === "ready";
        });
        // Send a pause command which writes a third state-changed event.
        manager.send("a-live", { kind: "pause", reason: "lunch" });
        const live = await readFrame(reader, (f) => {
            if (f.event !== "state-changed") return false;
            const event = f.data as { to: { kind: string } };
            return event.to.kind === "paused";
        });
        const event = live.data as { to: { kind: string; reason: string } };
        assert.equal(event.to.kind, "paused");
        assert.equal(event.to.reason, "lunch");
        reader.cancel().catch(() => undefined);
    } finally {
        await cleanup();
    }
});
