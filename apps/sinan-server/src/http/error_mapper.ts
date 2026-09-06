import type { ServerResponse } from "node:http";
import { ManagerError } from "../actors/index.js";

/**
 * Thrown by HTTP handlers to signal a domain-level error that maps cleanly
 * to a non-2xx response. Anything that escapes the router without being an
 * `HttpError` is mapped to `500 internal-error`.
 */
export class HttpError extends Error {
    public readonly status: number;
    public readonly code: string;
    public readonly details: Readonly<Record<string, unknown>> | null;

    public constructor(
        status: number,
        code: string,
        message: string,
        details: Readonly<Record<string, unknown>> | null = null,
    ) {
        super(message);
        this.name = "HttpError";
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

/**
 * Converts thrown values into the uniform `{ code, message, details }` body
 * mandated by `docs/server-http-api.md` §3.3. Always writes a response;
 * never re-throws.
 */
export class ErrorMapper {
    public async handle(res: ServerResponse, error: unknown): Promise<void> {
        if (res.headersSent) {
            // Body already in flight; we can only destroy the socket.
            res.destroy(error instanceof Error ? error : undefined);
            return;
        }

        if (error instanceof ManagerError) {
            const status = statusForManagerError(error.code);
            await this.writeJson(res, status, {
                code: error.code,
                message: error.message,
                details: error.details,
            });
            return;
        }

        if (error instanceof HttpError) {
            await this.writeJson(res, error.status, {
                code: error.code,
                message: error.message,
                details: error.details,
            });
            return;
        }

        // Unknown error → 500. Log to stderr so the operator can see it.
        console.error("Unhandled HTTP error:", error);
        await this.writeJson(res, 500, {
            code: "internal-error",
            message: "Internal server error",
            details: null,
        });
    }

    private async writeJson(
        res: ServerResponse,
        status: number,
        body: { code: string; message: string; details: Readonly<Record<string, unknown>> | null },
    ): Promise<void> {
        res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(body));
    }
}

/**
 * Maps `actor-runtime.md` §9 error codes to HTTP status codes. The same
 * code is used for the wire body, so clients can branch on the body
 * independently of the status.
 */
function statusForManagerError(code: ManagerError["code"]): number {
    switch (code) {
        case "actor-not-found":
            return 404;
        case "invalid-state-transition":
            return 409;
        case "policy-violation":
            return 422;
        case "not-implemented":
            return 501;
        case "persistence-unavailable":
            return 503;
    }
}
