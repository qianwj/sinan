import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, ViteDevServer } from "vite";
import { officeFixtures } from "../src/lib/fixtures.js";

/**
 * Dev-only Vite plugin that serves the same wire shape the sinan-server
 * exposes at `/api/actors` and `/api/health`. The web components call
 * `fetch('/api/actors')` and don't know whether they're talking to the
 * real server or to this mock. When `sinan-server` lands, switch the
 * baseURL once and the office works unchanged.
 *
 * Scoped to `configureServer` (dev only) so production builds are not
 * affected — the static `build/` does not include this middleware.
 */
export function mockApiPlugin(): Plugin {
    return {
        name: "sinan-mock-api",
        apply: "serve",
        configureServer(server: ViteDevServer) {
            server.middlewares.use("/api/actors", (req, res, next) => {
                if (req.method !== "GET") {
                    next();
                    return;
                }
                sendJson(res, 200, { actors: officeFixtures });
            });

            server.middlewares.use("/api/health", (req, res, next) => {
                if (req.method !== "GET") {
                    next();
                    return;
                }
                const quarantined = officeFixtures.filter(
                    (view) => view.state.kind === "quarantined",
                ).length;
                sendJson(res, 200, {
                    status: "ok",
                    version: "0.0.0-mock",
                    actorCount: officeFixtures.length,
                    quarantinedCount: quarantined,
                });
            });
        },
    };
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    const req = res as ServerResponse & { req: IncomingMessage };
    void req; // unused; the typing is here for clarity
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(text);
}
