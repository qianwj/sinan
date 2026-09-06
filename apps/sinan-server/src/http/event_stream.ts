import type { IncomingMessage, ServerResponse } from "node:http";
import type { ActorId, EventSequence, Timestamp } from "sinan-core";
import type { ActorConfigRepository, ActorEventRepository } from "../persistence/actor.js";
import type { EventPublisher, PublishedEvent, Unsubscribe } from "../events/event_publisher.js";
import type { RouteDefinition } from "./router.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

/** Replay cap when a client resumes without a `Last-Event-ID` cap. */
const REPLAY_HARD_LIMIT = 500;

/**
 * `GET /events` Server-Sent-Events endpoint (server-http-api.md §8).
 *
 * Wire shape: each frame is
 *   `id: <eventId>\nevent: state-changed\ndata: <json>\n\n`.
 * The `id:` is the row id from `actor_event.event_id`; clients resume by
 * passing it back as `Last-Event-ID`. Heartbeats are sent every 30s as
 * comment lines (`: keepalive`) so intermediate proxies do not time the
 * connection out.
 *
 * Wiring:
 * 1. on connect, look up the cursor event's `created_at` and replay every
 *    event recorded after it (or, absent a cursor, the most recent
 *    `REPLAY_HARD_LIMIT` events) — reading through the repositories so a
 *    client that was offline during a crash still gets the missed facts;
 * 2. then subscribe to the in-process `EventPublisher` for new events.
 *
 * The handler does not own an SSE parser; the standard `EventSource` API
 * in the browser handles the wire format transparently.
 */
export class EventStreamHandler {
    public constructor(
        private readonly publisher: EventPublisher,
        private readonly configRepository: ActorConfigRepository,
        private readonly eventRepository: ActorEventRepository,
    ) {}

    public get routes(): readonly RouteDefinition[] {
        return [
            { method: "GET", pattern: "/events", handler: this.stream.bind(this) },
        ];
    }

    private stream(req: IncomingMessage, res: ServerResponse): void {
        const resumeFromId = parseLastEventId(req.headers["last-event-id"]);

        res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "connection": "keep-alive",
        });

        const heartbeat = setInterval(() => {
            try {
                res.write(": keepalive\n\n");
            } catch {
                // res.write may throw after the client disconnects; the
                // close handler below will tear everything down.
            }
        }, HEARTBEAT_INTERVAL_MS);

        const unsubscribe: Unsubscribe = this.publisher.subscribeAll((envelope) => {
            sendEvent(res, envelope);
        });

        let closed = false;
        req.on("close", () => {
            closed = true;
            clearInterval(heartbeat);
            unsubscribe();
        });

        try {
            let replayed = 0;
            let cursorAt: Timestamp | null = null;
            if (resumeFromId === null) {
                // No cursor: deliver the most recent events so a fresh
                // client does not get an empty stream. The replay is
                // bounded by REPLAY_HARD_LIMIT.
                const recent = this.eventRepository.listAllAfterTimestamp(0, REPLAY_HARD_LIMIT);
                for (const envelope of recent) {
                    if (closed) break;
                    if (!this.configRepository.findById(envelope.actorId).isPresent()) continue;
                    sendEvent(res, envelope);
                    replayed += 1;
                }
            } else {
                const cursor = this.eventRepository.findEventCreatedAt(resumeFromId);
                if (cursor.isPresent()) {
                    cursorAt = cursor.get();
                    const missed = this.eventRepository.listAllAfterTimestamp(cursorAt, REPLAY_HARD_LIMIT);
                    for (const envelope of missed) {
                        if (closed) break;
                        if (!this.configRepository.findById(envelope.actorId).isPresent()) continue;
                        sendEvent(res, envelope);
                        replayed += 1;
                    }
                }
            }
            if (resumeFromId !== null) {
                res.write(
                    `id: ${resumeFromId}\nevent: resume-marker\ndata: ${JSON.stringify({ from: resumeFromId, replayed, cursorAt })}\n\n`,
                );
            }
        } catch (cause) {
            res.write(
                `event: error\ndata: ${JSON.stringify({ message: errorMessage(cause) })}\n\n`,
            );
        }
    }
}

function sendEvent(res: ServerResponse, envelope: PublishedEvent): void {
    try {
        res.write(
            `id: ${envelope.eventId}\nevent: state-changed\ndata: ${JSON.stringify(envelope.event)}\n\n`,
        );
    } catch {
        // The client probably disconnected; the close handler tears down.
    }
}

function parseLastEventId(header: string | string[] | undefined): string | null {
    const value = Array.isArray(header) ? header[0] : header;
    if (typeof value !== "string" || value.length === 0) {
        return null;
    }
    return value;
}

function errorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

// Re-export so callers using the events module see the same shape used
// to bridge between publisher envelopes and SSE frames.
export type { PublishedEvent };
// Silence "unused" lints — the brand aliases are imported for clarity at
// the file boundary even though they are not directly referenced here.
export type { ActorId, EventSequence, Timestamp };
