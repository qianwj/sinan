import { randomUUID } from "node:crypto";
import { Optional } from "sinan-core";
import type { Database, SqlNamedParameters } from "./database.js";
import {
    DEFAULT_RESTART_POLICY,
    type ActorConfig,
    type ActorEvent,
    type ActorId,
    type ActorState,
    type ActorStateKind,
    type ActorSummary,
    type ActorView,
    type EventCause,
    type EventSequence,
    type Timestamp,
} from "../actors/index.js";

/**
 * Row shape of `actor_config` as returned by `SELECT *`. The `config_json`
 * column holds the serialized `ActorConfig`; callers go through the public
 * repository methods to obtain parsed values.
 */
interface ActorConfigRow {
    id: string;
    config_json: string;
    state_kind: string;
    created_at: number;
    updated_at: number;
}

/**
 * Row shape of `actor_event` as returned by `SELECT *`. The `event_json` column
 * holds the event payload; the `sequence` and `created_at` columns carry the
 * values that join the payload to a per-actor timeline.
 */
interface ActorEventRow {
    actor_id: string;
    sequence: number;
    event_id: string;
    event_json: string;
    created_at: number;
}

/**
 * Persists and reads `actor_config` rows.
 *
 * The repository owns parsing of `config_json`; callers always see typed
 * `ActorConfig` values. The `state_kind` column is a redundant cache of the
 * latest `state-changed` event's `to.kind`, used for filtered list queries
 * (e.g., `list({ stateKind: "quarantined" })`).
 */
export class ActorConfigRepository {
    private readonly database: Database;

    public constructor(database: Database) {
        this.database = database;
    }

    public create(config: ActorConfig, state: ActorState, at: Timestamp): void {
        this.database.run(
            `INSERT INTO actor_config (id, config_json, state_kind, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)`,
            config.id,
            JSON.stringify(config),
            state.kind,
            at,
            at,
        );
    }

    /**
     * Updates the redundant `state_kind` cache and bumps `updated_at`. Must be
     * called inside the same transaction as the matching `recordStateChanged`
     * call so the column and the event log can never disagree.
     */
    public updateOne(actorId: ActorId, state: ActorState, at: Timestamp): void {
        const result = this.database.run(
            "UPDATE actor_config SET state_kind = ?, updated_at = ? WHERE id = ?",
            state.kind,
            at,
            actorId,
        );
        if (result.changes !== 1) {
            throw new Error(`Actor ${actorId} does not exist while persisting state`);
        }
    }

    /** Returns the parsed config for every persisted actor. */
    public findAll(): ActorConfig[] {
        return this.database
            .all<ActorConfigRow>("SELECT * FROM actor_config")
            .map((row) => parseConfigRow(row));
    }

    public findById(actorId: ActorId): Optional<ActorConfig> {
        return this.database
            .get<ActorConfigRow>("SELECT * FROM actor_config WHERE id = ?", actorId)
            .map((row) => parseConfigRow(row));
    }

    /**
     * Returns a summary for each persisted actor. `lastEventAt` is `null` when
     * the actor has no events yet (the freshly-created case). `stateKind` is
     * taken from the redundant column; an optional `stateKind` filter is
     * translated into a WHERE clause.
     */
    public findAllSummaries(
        filter: { role?: string; stateKind?: string; workspace?: string } = {},
    ): ActorSummary[] {
        const where: string[] = [];
        const params: Array<string | number> = [];
        if (filter.role !== undefined) {
            where.push("json_extract(config_json, '$.role') = ?");
            params.push(filter.role);
        }
        if (filter.stateKind !== undefined) {
            where.push("state_kind = ?");
            params.push(filter.stateKind);
        }
        if (filter.workspace !== undefined) {
            where.push("json_extract(config_json, '$.workspace') = ?");
            params.push(filter.workspace);
        }
        const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const sql = `
            SELECT c.id,
                   c.state_kind,
                   json_extract(c.config_json, '$.role') AS role,
                   json_extract(c.config_json, '$.workspace') AS workspace,
                   (SELECT MAX(e.created_at) FROM actor_event e WHERE e.actor_id = c.id) AS last_event_at
            FROM actor_config c
            ${whereClause}
            ORDER BY c.created_at ASC
        `;
        type SummaryRow = {
            id: string;
            state_kind: string;
            role: string;
            workspace: string;
            last_event_at: number | null;
        };
        return this.database.all<SummaryRow>(sql, ...params).map((row) => ({
            id: row.id,
            role: row.role as ActorSummary["role"],
            stateKind: row.state_kind as ActorStateKind,
            lastEventAt: row.last_event_at,
            workspace: row.workspace,
        }));
    }

    /**
     * Returns a full `ActorView` for every persisted actor that matches
     * `filter`, with the latest state and event timestamp joined in. Inner
     * joins on `actor_event` so configs that have no events (the
     * missingConfigs case in §8.5) are excluded — those have no recoverable
     * state to surface. `policy` is normalized to `DEFAULT_RESTART_POLICY`
     * for legacy rows that predate the field.
     */
    public findAllViews(
        filter: { role?: string; stateKind?: string; workspace?: string } = {},
    ): ActorView[] {
        const where: string[] = [];
        const params: Array<string | number> = [];
        if (filter.role !== undefined) {
            where.push("json_extract(c.config_json, '$.role') = ?");
            params.push(filter.role);
        }
        if (filter.stateKind !== undefined) {
            where.push("c.state_kind = ?");
            params.push(filter.stateKind);
        }
        if (filter.workspace !== undefined) {
            where.push("json_extract(c.config_json, '$.workspace') = ?");
            params.push(filter.workspace);
        }
        const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const sql = `
            SELECT c.id,
                   c.config_json,
                   e.event_json AS last_event_json,
                   e.created_at AS last_event_at
            FROM actor_config c
            JOIN actor_event e
              ON e.actor_id = c.id
             AND e.sequence = (SELECT MAX(sequence) FROM actor_event WHERE actor_id = c.id)
            ${whereClause}
            ORDER BY c.created_at ASC
        `;
        type ViewRow = {
            id: string;
            config_json: string;
            last_event_json: string;
            last_event_at: number;
        };
        return this.database.all<ViewRow>(sql, ...params).map((row) => {
            const config = parseConfigRow({
                id: row.id,
                config_json: row.config_json,
                state_kind: "",
                created_at: 0,
                updated_at: 0,
            });
            const event = JSON.parse(row.last_event_json) as { to: ActorState };
            return {
                id: row.id,
                config,
                state: event.to,
                lastEventAt: row.last_event_at,
            };
        });
    }
}

/**
 * Persists and reads the immutable `actor_event` log.
 *
 * The repository owns parsing of `event_json`; callers always see typed
 * `ActorEvent` values. Inserts and updates in `actor_config` must happen
 * inside a single transaction with the matching `recordStateChanged` so the
 * redundant column and the event log can never diverge.
 */
export class ActorEventRepository {
    private readonly database: Database;

    public constructor(database: Database) {
        this.database = database;
    }

    /**
     * Appends one state-changed event to an actor's immutable event log.
     *
     * Atomicity comes from a single SQL statement: the next sequence is
     * computed from MAX(sequence) inside a subquery and the row is inserted
     * with RETURNING. No internal transaction is opened, so this method
     * composes safely inside an outer transaction (e.g., the one wrapping
     * `ActorConfigRepository.updateOne` + `recordStateChanged` in `persistState`).
     *
     * @returns The assigned per-actor sequence number.
     */
    public recordStateChanged(
        actorId: ActorId,
        from: ActorState,
        to: ActorState,
        cause: EventCause,
        at: Timestamp,
    ): number {
        const inserted = this.database
            .get<{ sequence: number }>(
                `INSERT INTO actor_event (actor_id, sequence, event_id, event_json, created_at)
                 VALUES (
                     ?,
                     COALESCE((SELECT MAX(sequence) FROM actor_event WHERE actor_id = ?), 0) + 1,
                     ?, ?, ?
                 )
                 RETURNING sequence`,
                actorId,
                actorId,
                randomUUID(),
                JSON.stringify({ kind: "state-changed", from, to, at, cause }),
                at,
            )
            .get();
        return inserted.sequence;
    }

    /**
     * Returns the latest event for an actor, or empty when no event has been
     * recorded yet. The result carries the parsed state, the sequence number,
     * and the timestamp — enough to render `ActorView.lastEventAt` and the
     * `to` snapshot.
     */
    public findLatest(actorId: ActorId): Optional<{
        sequence: EventSequence;
        state: ActorState;
        at: Timestamp;
    }> {
        return this.database
            .get<ActorEventRow>(
                `SELECT actor_id, sequence, event_id, event_json, created_at
                 FROM actor_event
                 WHERE actor_id = ?
                 ORDER BY sequence DESC
                 LIMIT 1`,
                actorId,
            )
            .map((row) => {
                const parsed = parseEventRow(row);
                if (parsed.kind !== "state-changed") {
                    throw new Error(
                        `Expected latest event for ${actorId} to be state-changed; got ${parsed.kind}`,
                    );
                }
                return {
                    sequence: parsed.sequence,
                    state: parsed.to,
                    at: parsed.at,
                };
            });
    }

    /**
     * Returns events for an actor whose `sequence` is greater than `since`.
     * Pass `since = 0` to read from the start of the log; the first sequence
     * is 1, so the predicate is naturally inclusive of the earliest event.
     * Results are ordered by `sequence ASC` and capped at `limit` rows.
     */
    public listSince(actorId: ActorId, since: EventSequence, limit: number): ActorEvent[] {
        if (limit <= 0) {
            return [];
        }
        return this.database
            .all<ActorEventRow>(
                `SELECT actor_id, sequence, event_id, event_json, created_at
                 FROM actor_event
                 WHERE actor_id = ? AND sequence > ?
                 ORDER BY sequence ASC
                 LIMIT ?`,
                actorId,
                since,
                limit,
            )
            .map((row) => parseEventRow(row));
    }

    /**
     * Returns distinct `actor_id` values present in `actor_event` that are
     * not in `knownIds`. Used during recovery to surface orphan events whose
     * originating actor has been removed from `actor_config`.
     */
    public findOrphanActorIds(knownIds: ReadonlySet<ActorId>): ActorId[] {
        if (knownIds.size === 0) {
            // `NOT IN ()` is a syntax error in SQLite; the empty case means
            // every distinct actor_id is an orphan.
            return this.database
                .all<{ actor_id: string }>(
                    "SELECT DISTINCT actor_id FROM actor_event",
                )
                .map((row) => row.actor_id);
        }
        const placeholders = Array.from(knownIds, () => "?").join(", ");
        const sql = `SELECT DISTINCT actor_id FROM actor_event WHERE actor_id NOT IN (${placeholders})`;
        return this.database
            .all<{ actor_id: string }>(sql, ...knownIds)
            .map((row) => row.actor_id);
    }
}

/** Parses an `actor_config` row into the typed `ActorConfig` stored in JSON. */
function parseConfigRow(row: ActorConfigRow): ActorConfig {
    const parsed = JSON.parse(row.config_json) as ActorConfig;
    // `config_json` is written by `create` and never mutated; assert the column
    // matches the JSON id to catch silent corruption early.
    if (parsed.id !== row.id) {
        throw new Error(
            `actor_config ${row.id} contains a config_json with mismatched id ${parsed.id}`,
        );
    }
    // `policy` was added after the initial schema. Normalize missing values
    // so callers always see a concrete `RestartPolicy` without conditionals.
    if (parsed.policy === undefined) {
        return { ...parsed, policy: DEFAULT_RESTART_POLICY };
    }
    return parsed;
}

/** Parses an `actor_event` row into the typed `ActorEvent` union. */
function parseEventRow(row: ActorEventRow): ActorEvent {
    const payload = JSON.parse(row.event_json) as Record<string, unknown>;
    const kind = payload.kind;
    if (typeof kind !== "string") {
        throw new Error(
            `actor_event row at sequence ${row.sequence} is missing a string "kind"`,
        );
    }
    return { ...(payload as object), sequence: row.sequence } as ActorEvent;
}
