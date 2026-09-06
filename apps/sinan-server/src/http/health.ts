import type { IncomingMessage, ServerResponse } from "node:http";
import type { ActorManager } from "../actors/index.js";
import type { RouteDefinition } from "./router.js";

const VERSION = "0.0.1";

/**
 * `GET /api/health` (server-http-api.md §9). Reports basic readiness plus
 * actor counts so an operator can confirm the manager has reloaded and
 * see whether any actors need human attention.
 *
 * Generic over the manager's agent type for the same reason as
 * `ActorRoutes` — the wire surface never depends on it.
 */
export class HealthRoutes<TAgent extends object = object> {
    public constructor(private readonly manager: ActorManager<TAgent>) {}

    public get routes(): readonly RouteDefinition[] {
        return [
            { method: "GET", pattern: "/api/health", handler: this.health.bind(this) },
        ];
    }

    private health(_req: IncomingMessage, res: ServerResponse): void {
        const actors = this.manager.list();
        const quarantined = this.manager.list({ stateKind: "quarantined" });
        const body = {
            status: "ok",
            since: this.startedAt,
            version: VERSION,
            actorCount: actors.length,
            quarantinedCount: quarantined.length,
        };
        res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
    }

    private readonly startedAt: number = Date.now();
}
