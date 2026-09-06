import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDefinition } from "./router.js";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * `GET /events` Server-Sent-Events endpoint (server-http-api.md §8).
 *
 * Current scope:
 * - sends a `resume-marker` frame when `Last-Event-ID` is present;
 * - emits a `: keepalive` comment frame every 30s to keep proxies open.
 *
 * Not yet wired:
 * - subscription to the event bus (frames have to come from somewhere);
 * - replay of historical events past `Last-Event-ID`.
 */
export class EventStreamHandler {
    public get routes(): readonly RouteDefinition[] {
        return [
            { method: "GET", pattern: "/events", handler: this.stream.bind(this) },
        ];
    }

    private stream(req: IncomingMessage, res: ServerResponse): void {
        const resumeFrom = parseLastEventId(req.headers["last-event-id"]);

        res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            "connection": "keep-alive",
        });

        const heartbeat = setInterval(() => {
            res.write(": keepalive\n\n");
        }, HEARTBEAT_INTERVAL_MS);

        req.on("close", () => {
            clearInterval(heartbeat);
        });

        if (resumeFrom !== null) {
            res.write(
                `id: ${resumeFrom}\nevent: resume-marker\ndata: ${JSON.stringify({ from: resumeFrom })}\n\n`,
            );
        }
    }
}

function parseLastEventId(header: string | string[] | undefined): number | null {
    const value = Array.isArray(header) ? header[0] : header;
    if (typeof value !== "string" || value.length === 0) {
        return null;
    }
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}
