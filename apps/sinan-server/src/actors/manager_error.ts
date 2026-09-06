import type { ManagerErrorCode } from "sinan-core";

/**
 * Thrown by `ActorManager.send` to surface a domain error to the HTTP layer.
 * The router maps the `code` to a status:
 *
 * | code                          | HTTP |
 * |-------------------------------|------|
 * | actor-not-found               | 404  |
 * | invalid-state-transition      | 409  |
 * | policy-violation              | 422  |
 * | not-implemented               | 501  |
 * | persistence-unavailable       | 503  |
 *
 * Mirrors `actor-runtime.md` §9.
 */
export class ManagerError extends Error {
    public readonly code: ManagerErrorCode;
    public readonly details: Readonly<Record<string, unknown>> | null;

    public constructor(
        code: ManagerErrorCode,
        message: string,
        details: Readonly<Record<string, unknown>> | null = null,
    ) {
        super(message);
        this.name = "ManagerError";
        this.code = code;
        this.details = details;
    }
}
