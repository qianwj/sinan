import { DatabaseSync } from "node:sqlite";
import type {
  SQLInputValue,
  SQLOutputValue,
  StatementResultingChanges,
  StatementSync,
} from "node:sqlite";
import { dirname, resolve } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { Optional } from "sinan-core";

const DEFAULT_DB_PATH = "~/.sinan/sinan.db";
const MEMORY_DB_PATH = ":memory:";

// Per docs/actor-schema.sql: connection-level pragmas are mandatory for WAL
// mode and foreign-key enforcement. Applied once at open time.
const STARTUP_PRAGMAS = [
  "PRAGMA journal_mode = WAL;",
  "PRAGMA foreign_keys = ON;",
];

/**
 * Synchronous SQLite access for server persistence.
 *
 * `run` is used for writes, `get` returns at most one typed row wrapped in an
 * Optional, and `all` returns every matching row as an array. All parameter
 * values are bound through prepared statements.
 *
 * @example
   * ```ts
   * using database = new Database(":memory:");
   * database.exec("CREATE TABLE records (id INTEGER PRIMARY KEY, text TEXT NOT NULL)");
   * database.run("INSERT INTO records (text) VALUES (?)", "ready");
   * const row = database.get<{ id: number; text: string }>("SELECT * FROM records");
   * ```
 */
export class Database implements Disposable {
  public readonly path: string;
  private readonly db: DatabaseSync;
  private closed = false;
  private transactionState: TransactionState = "idle";

  /**
   * Opens a SQLite database and enables foreign-key enforcement.
   *
   * Omit `databasePath` to use `SINAN_DB_PATH`, or the default
   * `~/.sinan/sinan.db`. Pass `":memory:"` for an isolated in-memory database.
   *
   * @param databasePath Optional database path override.
   * @example
   * ```ts
   * using database = new Database(":memory:");
   * database.exec("CREATE TABLE greeting (message TEXT NOT NULL)");
   * ```
   */
  constructor(databasePath?: string) {
    this.path = Database.resolvePath(databasePath);
    this.db = new DatabaseSync(this.path);
    for (const pragma of STARTUP_PRAGMAS) {
      this.db.exec(pragma);
    }
  }

  /**
   * Executes a SQL statement and returns its SQLite change summary.
   *
   * Parameters are bound by SQLite; do not interpolate user input into `sql`.
   * The first parameter may be a named-parameter object, followed by optional
   * anonymous parameters.
   *
   * @param sql SQL statement with `?`, `:name`, `$name`, or `@name` placeholders.
   * @param parameters Positional values, or a named-parameter object followed by positional values.
   * @returns The number of changed rows and the last inserted row id.
   * @example
   * ```ts
   * const result = database.run(
   *   "INSERT INTO actor_config (id, config_json) VALUES (:id, :config)",
   *   { id: "actor-1", config: "{}" },
   * );
   * console.log(result.changes);
   * ```
   */
  public run(sql: string, ...parameters: SQLInputValue[]): StatementResultingChanges;
  public run(
    sql: string,
    namedParameters: SqlNamedParameters,
    ...anonymousParameters: SQLInputValue[]
  ): StatementResultingChanges;
  public run(
    sql: string,
    ...parameters: Array<SQLInputValue | SqlNamedParameters>
  ): StatementResultingChanges {
    return this.withStatement(sql, (statement) =>
      this.executeWithParameters(statement, parameters, (boundStatement, named, anonymous) =>
        named === undefined
          ? boundStatement.run(...anonymous)
          : boundStatement.run({ ...named }, ...anonymous),
      ),
    );
  }

  /**
   * Returns the first row, or an empty Optional when no row matches.
   *
   * @typeParam T TypeScript shape of the selected row.
   * @param sql SQL query with optional placeholders.
   * @param parameters Positional values, or a named-parameter object followed by positional values.
   * @returns An Optional containing the first row.
   * @example
   * ```ts
   * const actor = database.get<{ id: string; stateKind: string }>(
   *   "SELECT id, state_kind AS stateKind FROM actor_config WHERE id = ?",
   *   "actor-1",
   * );
   * actor.ifPresent(({ stateKind }) => console.log(stateKind));
   * ```
   */
  public get<T extends object = SqlRow>(sql: string, ...parameters: SQLInputValue[]): Optional<T>;
  public get<T extends object = SqlRow>(
    sql: string,
    namedParameters: SqlNamedParameters,
    ...anonymousParameters: SQLInputValue[]
  ): Optional<T>;
  public get<T extends object = SqlRow>(
    sql: string,
    ...parameters: Array<SQLInputValue | SqlNamedParameters>
  ): Optional<T> {
    const row = this.withStatement(sql, (statement) =>
      this.executeWithParameters(statement, parameters, (boundStatement, named, anonymous) =>
        named === undefined
          ? boundStatement.get(...anonymous)
          : boundStatement.get({ ...named }, ...anonymous),
      ),
    );
    return Optional.ofNullable(row === undefined ? undefined : normalizeRow(row) as T);
  }

  /**
   * Returns every matching row, or an empty array when no rows match.
   *
   * @typeParam T TypeScript shape of each selected row.
   * @param sql SQL query with optional placeholders.
   * @param parameters Positional values, or a named-parameter object followed by positional values.
   * @returns A new array containing normalized row objects.
   * @example
   * ```ts
   * const actors = database.all<{ id: string }>(
   *   "SELECT id FROM actor_config ORDER BY id",
   * );
   * ```
   */
  public all<T extends object = SqlRow>(sql: string, ...parameters: SQLInputValue[]): T[];
  public all<T extends object = SqlRow>(
    sql: string,
    namedParameters: SqlNamedParameters,
    ...anonymousParameters: SQLInputValue[]
  ): T[];
  public all<T extends object = SqlRow>(
    sql: string,
    ...parameters: Array<SQLInputValue | SqlNamedParameters>
  ): T[] {
    const rows = this.withStatement(sql, (statement) =>
      this.executeWithParameters(statement, parameters, (boundStatement, named, anonymous) =>
        named === undefined
          ? boundStatement.all(...anonymous)
          : boundStatement.all({ ...named }, ...anonymous),
      ),
    );
    return rows.map((row) => normalizeRow(row) as T);
  }

  /**
   * Executes one or more SQL statements without returning rows.
   *
   * Use `run` for parameterized statements. `exec` is intended for trusted SQL
   * such as schema setup and migrations.
   *
   * @param sql Trusted SQL text, potentially containing multiple statements.
   * @example `database.exec("CREATE TABLE example (id INTEGER PRIMARY KEY)");`
   */
  public exec(sql: string): void {
    this.assertOpen();
    this.db.exec(sql);
  }

  /**
   * Runs a synchronous operation in a transaction and rolls it back when the
   * operation throws. The callback uses this Database facade for all database
   * access. Nested transactions and async callbacks are rejected.
   *
   * @param operation Synchronous callback containing the transaction work.
   * @returns The callback's return value after the transaction commits.
   * @throws TypeError If `operation` is not a function or returns a Promise.
   * @throws Error If a transaction is already active or the database is unusable.
   * @throws AggregateError If both the operation and its rollback fail.
   * @example
   * ```ts
   * database.transaction(() => {
   *   database.run("INSERT INTO actor_event (actor_id) VALUES (?)", "actor-1");
   *   database.run("UPDATE actor_config SET updated_at = ?", Date.now());
   * });
   * ```
   */
  public transaction<T>(operation: () => Synchronous<T>): Synchronous<T> {
    this.assertOpen();
    if (typeof operation !== "function") {
      throw new TypeError("Database.transaction operation must be a function");
    }
    if (this.transactionState === "active") {
      throw new Error("Nested database transactions are not supported");
    }

    this.exec("BEGIN");
    this.transactionState = "active";
    let asynchronousCallback: PromiseLike<unknown> | undefined;
    try {
      const result = operation();
      if (isPromiseLike(result)) {
        asynchronousCallback = result;
        throw new TypeError("Database.transaction operation must be synchronous");
      }
      this.exec("COMMIT");
      this.transactionState = "idle";
      return result;
    } catch (cause) {
      let rollbackFailed = false;
      let rollbackCause: unknown;
      try {
        this.exec("ROLLBACK");
      } catch (error) {
        rollbackFailed = true;
        rollbackCause = error;
      }

      if (rollbackFailed) {
        this.transactionState = "unknown";
        if (asynchronousCallback !== undefined) {
          this.observeCallback(asynchronousCallback);
        }
        throw new AggregateError(
          [cause, rollbackCause],
          "Database transaction failed and rollback also failed",
          { cause },
        );
      }

      if (asynchronousCallback === undefined) {
        this.transactionState = "idle";
      } else {
        this.blockUntilCallbackSettles(asynchronousCallback);
      }
      throw cause;
    }
  }

  /** Closes the database connection; repeated calls are safe. */
  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }

  /** Supports explicit resource management with a `using` declaration. */
  public [Symbol.dispose](): void {
    this.close();
  }

  /** Prepares one statement, executes the operation, and releases the statement. */
  private withStatement<T>(sql: string, operation: (statement: StatementSync) => T): T {
    this.assertOpen();
    const statement = this.db.prepare(sql);
    try {
      statement.setAllowBareNamedParameters(true);
      return operation(statement);
    } finally {
      // Older node:sqlite type declarations omit close(), although newer
      // runtimes expose it. Release explicitly when the runtime supports it.
      (statement as ClosableStatement).close?.();
    }
  }

  /** Dispatches named and positional bindings to the corresponding SQLite overload. */
  private executeWithParameters<T>(
    statement: StatementSync,
    parameters: ReadonlyArray<SQLInputValue | SqlNamedParameters>,
    operation: (
      statement: StatementSync,
      namedParameters: SqlNamedParameters | undefined,
      anonymousParameters: SQLInputValue[],
    ) => T,
  ): T {
    const [firstParameter, ...remainingParameters] = parameters;
    if (firstParameter !== undefined && isNamedParameters(firstParameter)) {
      return operation(statement, firstParameter, remainingParameters as SQLInputValue[]);
    }
    return operation(statement, undefined, parameters as SQLInputValue[]);
  }

  /** Rejects operations when the connection or transaction state is unusable. */
  private assertOpen(): void {
    if (this.closed) {
      throw new Error("Database is closed");
    }
    if (this.transactionState === "blocked") {
      throw new Error("Database is waiting for an asynchronous transaction callback to settle");
    }
    if (this.transactionState === "unknown") {
      throw new Error("Database transaction state is unknown after rollback failure");
    }
  }

  /** Prevents an async callback from issuing database operations after rollback. */
  private blockUntilCallbackSettles(callback: PromiseLike<unknown>): void {
    this.transactionState = "blocked";
    this.observeCallback(callback);
  }

  /** Consumes the rejected callback promise so async misuse never becomes unhandled. */
  private observeCallback(callback: PromiseLike<unknown>): void {
    void Promise.resolve(callback).then(
      () => this.releaseBlockedTransaction(),
      () => this.releaseBlockedTransaction(),
    );
  }

  /** Releases the temporary operation block after an async callback settles. */
  private releaseBlockedTransaction(): void {
    if (this.transactionState === "blocked") {
      this.transactionState = "idle";
    }
  }

  /** Resolves a path and creates its parent directory for file-backed databases. */
  private static resolvePath(databasePath?: string): string {
    const dbPath = databasePath ?? process.env.SINAN_DB_PATH ?? DEFAULT_DB_PATH;
    if (dbPath === MEMORY_DB_PATH) {
      return dbPath;
    }

    const resolvedPath = resolve(
      dbPath.startsWith("~") ? dbPath.replace("~", homedir()) : dbPath,
    );
    mkdirSync(dirname(resolvedPath), { recursive: true });
    return resolvedPath;
  }
}

/** Internal lifecycle states used to protect transaction boundaries. */
type TransactionState = "idle" | "active" | "blocked" | "unknown";

/** Excludes Promise-like callback results from the synchronous transaction API. */
type Synchronous<T> = T extends PromiseLike<unknown> ? never : T;

/** Named values accepted by SQLite placeholders such as `:name` and `$name`. */
export type SqlNamedParameters = Readonly<Record<string, SQLInputValue>>;

/** Default row shape returned by `Database.get` and `Database.all`. */
export type SqlRow = Record<string, SQLOutputValue>;

// Re-export persistence orchestration for callers that use database.ts as the
// persistence entry point. Migrator itself only depends on Database methods.
export { MigrationError, Migrator } from "./migrator.js";
export type { Migration, MigrationResult } from "./migrator.js";

type ClosableStatement = StatementSync & { close?: () => void };

/** Distinguishes named binding objects from SQLite scalar or binary values. */
function isNamedParameters(
  parameter: SQLInputValue | SqlNamedParameters,
): parameter is SqlNamedParameters {
  return typeof parameter === "object" && parameter !== null && !ArrayBuffer.isView(parameter);
}

/** Identifies Promise-like results that cannot be committed synchronously. */
function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return false;
  }
  return typeof (value as { then?: unknown }).then === "function";
}

/** Copies SQLite's null-prototype row into a normal object for callers. */
function normalizeRow(row: Record<string, SQLOutputValue>): SqlRow {
  return { ...row };
}
