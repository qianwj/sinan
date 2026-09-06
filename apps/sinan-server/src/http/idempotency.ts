import { Optional } from "sinan-core";

/**
 * Captured HTTP response used to replay an idempotent request.
 *
 * `headers` is stored as the value the handler set, so the replay produces
 * a byte-identical response. The store does not interpret them.
 */
export interface IdempotentResponse {
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
}

/**
 * In-memory idempotency store keyed by the `Idempotency-Key` header value.
 *
 * For the first runtime version this is a plain `Map` with a per-entry
 * expiry. Entries past `ttlMs` are swept lazily on read and on insert;
 * the store never blocks the request thread on a timer. A single-user
 * local server never produces enough keys for a small Map to matter.
 *
 * The store does not dedupe by request payload: callers that need
 * payload-bound idempotency must include the payload digest in the key
 * themselves. Per `server-http-api.md` §3.4, `POST /api/actors` is the
 * only endpoint that uses idempotency in v0.1.
 */
export class IdempotencyStore {
    private readonly ttlMs: number;
    private readonly clock: () => number;
    private readonly entries = new Map<string, Entry>();

    public constructor(
        ttlMs: number = DEFAULT_IDEMPOTENCY_TTL_MS,
        clock: () => number = Date.now,
    ) {
        this.ttlMs = ttlMs;
        this.clock = clock;
    }

    /**
     * Returns a previously stored response for `key` if one is still
     * within its TTL. Expired entries are dropped as a side effect.
     */
    public get(key: string): Optional<IdempotentResponse> {
        const entry = this.entries.get(key);
        if (entry === undefined) {
            return Optional.empty();
        }
        if (this.isExpired(entry)) {
            this.entries.delete(key);
            return Optional.empty();
        }
        return Optional.of(entry.response);
    }

    /**
     * Stores a response under `key` with the configured TTL. Overwrites
     * any previous entry (after a sweep of expired keys first).
     */
    public set(key: string, response: IdempotentResponse): void {
        this.sweepExpired();
        this.entries.set(key, { storedAt: this.clock(), response });
    }

    /** Number of live entries. Used by tests; not exposed on the wire. */
    public get size(): number {
        return this.entries.size;
    }

    private isExpired(entry: Entry): boolean {
        return this.clock() - entry.storedAt >= this.ttlMs;
    }

    /** Drops every entry that has outlived its TTL. */
    private sweepExpired(): void {
        for (const [key, entry] of this.entries) {
            if (this.isExpired(entry)) {
                this.entries.delete(key);
            }
        }
    }
}

/** 24 hours, per `server-http-api.md` §3.4. */
const DEFAULT_IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

interface Entry {
    storedAt: number;
    response: IdempotentResponse;
}
