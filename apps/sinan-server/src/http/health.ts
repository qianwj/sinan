import type { IncomingMessage, ServerResponse } from "node:http";
import type { RouteDefinition } from "./router.js";

const VERSION = "0.0.1";

/**
 * `GET /api/health` (server-http-api.md §9). Reports basic readiness.
 */
export class HealthRoutes {
    private readonly startedAt: number;

    public constructor() {
        this.startedAt = Date.now();
    }

    public get routes(): readonly RouteDefinition[] {
        return [
            { method: "GET", pattern: "/api/health", handler: this.health.bind(this) },
        ];
    }

    private health(_req: IncomingMessage, res: ServerResponse): void {
        const body = {
            status: "ok",
            since: this.startedAt,
            version: VERSION,
        };
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
    }
}
