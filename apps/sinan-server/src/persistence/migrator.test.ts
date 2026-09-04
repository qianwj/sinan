import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { Database } from "./database.js";
import { Migrator } from "./migrator.js";

test("applies numbered migrations once and records their order", () => {
  const directory = createMigrations({
    "002_second.sql": "CREATE TABLE second (value TEXT NOT NULL);",
    "001_first.sql": "CREATE TABLE first (value TEXT NOT NULL);",
  });

  try {
    using database = new Database(":memory:");
    const migrator = new Migrator(database, directory);

    assert.deepEqual(migrator.migrate(), {
      previousVersion: 0,
      currentVersion: 2,
      applied: [1, 2],
    });
    assert.deepEqual(migrator.migrate(), {
      previousVersion: 2,
      currentVersion: 2,
      applied: [],
    });
    assert.deepEqual(
      database.all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('first', 'second') ORDER BY name",
      ),
      [{ name: "first" }, { name: "second" }],
    );
  } finally {
    removeDirectory(directory);
  }
});

test("rolls back a failed migration without recording it", () => {
  const directory = createMigrations({
    "001_first.sql": "CREATE TABLE first (value TEXT NOT NULL);",
    "002_broken.sql": "CREATE TABLE second (value TEXT NOT NULL); SELECT * FROM missing_table;",
  });

  try {
    using database = new Database(":memory:");
    const migrator = new Migrator(database, directory);
    assert.throws(() => migrator.migrate(), /missing_table/);
    assert.deepEqual(database.all<{ version: number }>("SELECT version FROM schema_migrations"), [
      { version: 1 },
    ]);
    assert.equal(
      database.get("SELECT name FROM sqlite_master WHERE name = 'second'").isEmpty(),
      true,
    );
  } finally {
    removeDirectory(directory);
  }
});

test("adds actor_config.created_at and backfills legacy records", () => {
  const directory = createMigrations({
    "001_actor_persistence.sql": `
      CREATE TABLE actor_config (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        state_kind TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX idx_actor_config_state ON actor_config(state_kind);
      INSERT INTO actor_config (id, config_json, state_kind, updated_at)
      VALUES ('actor-1', '{}', 'ready', 1234);
    `,
    "002_actor_config_created_at.sql": `
      CREATE TABLE actor_config_with_created_at (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        state_kind TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO actor_config_with_created_at
        (id, config_json, state_kind, created_at, updated_at)
      SELECT id, config_json, state_kind, updated_at, updated_at
      FROM actor_config;
      DROP TABLE actor_config;
      ALTER TABLE actor_config_with_created_at RENAME TO actor_config;
      CREATE INDEX idx_actor_config_state ON actor_config(state_kind);
    `,
  });

  try {
    using database = new Database(":memory:");
    const result = new Migrator(database, directory).migrate();
    assert.deepEqual(result.applied, [1, 2]);
    const columns = database.all<{ name: string; notnull: number }>("PRAGMA table_info(actor_config)");
    assert.deepEqual(
      columns.map(({ name, notnull }) => ({ name, notnull })),
      [
        { name: "id", notnull: 0 },
        { name: "config_json", notnull: 1 },
        { name: "state_kind", notnull: 1 },
        { name: "created_at", notnull: 1 },
        { name: "updated_at", notnull: 1 },
      ],
    );
    assert.deepEqual(
      database.get<{ created_at: number }>(
        "SELECT created_at FROM actor_config WHERE id = ?",
        "actor-1",
      ).orElseThrow(),
      { created_at: 1234 },
    );
  } finally {
    removeDirectory(directory);
  }
});

test("Database.transaction commits or rolls back through the Database facade", () => {
  using database = new Database(":memory:");
  database.exec("CREATE TABLE values_table (value INTEGER NOT NULL)");

  database.transaction(() => {
    database.run("INSERT INTO values_table (value) VALUES (?)", 1);
  });
  assert.deepEqual(database.all("SELECT value FROM values_table"), [{ value: 1 }]);

  assert.throws(() => database.transaction(() => {
    database.run("INSERT INTO values_table (value) VALUES (?)", 2);
    throw new Error("abort");
  }), /abort/);
  assert.deepEqual(database.all("SELECT value FROM values_table"), [{ value: 1 }]);
});

test("rejects asynchronous callbacks and blocks database access until they settle", async () => {
  using database = new Database(":memory:");
  database.exec("CREATE TABLE values_table (value INTEGER NOT NULL)");

  if (false) {
    // @ts-expect-error Database.transaction only accepts synchronous callbacks.
    database.transaction(async () => undefined);
  }

  let lateError: unknown;

  const operation = async () => {
    database.run("INSERT INTO values_table (value) VALUES (?)", 1);
    await Promise.resolve();
    try {
      database.run("INSERT INTO values_table (value) VALUES (?)", 2);
    } catch (error) {
      lateError = error;
    }
  };

  assert.throws(
    () => database.transaction(operation as unknown as () => void),
    /operation must be synchronous/,
  );
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.match(String((lateError as Error).message), /asynchronous transaction callback/);
  assert.deepEqual(database.all("SELECT value FROM values_table"), []);
  database.run("INSERT INTO values_table (value) VALUES (?)", 3);
  assert.deepEqual(database.all("SELECT value FROM values_table"), [{ value: 3 }]);
});

test("rejects nested transactions without changing the outer transaction", () => {
  using database = new Database(":memory:");
  database.exec("CREATE TABLE values_table (value INTEGER NOT NULL)");

  database.transaction(() => {
    database.run("INSERT INTO values_table (value) VALUES (?)", 1);
    assert.throws(
      () => database.transaction(() => database.run("INSERT INTO values_table (value) VALUES (?)", 2)),
      /Nested database transactions are not supported/,
    );
    database.run("INSERT INTO values_table (value) VALUES (?)", 3);
  });

  assert.deepEqual(database.all("SELECT value FROM values_table ORDER BY value"), [
    { value: 1 },
    { value: 3 },
  ]);
});

test("preserves both operation and rollback failures and marks the state unusable", () => {
  using database = new Database(":memory:");
  database.exec("CREATE TABLE values_table (value INTEGER NOT NULL)");
  const operationError = new Error("operation failed");

  assert.throws(
    () => database.transaction(() => {
      database.exec("COMMIT");
      throw operationError;
    }),
    (error: unknown) =>
      error instanceof AggregateError
      && error.errors[0] === operationError
      && error.errors[1] instanceof Error,
  );
  assert.throws(() => database.all("SELECT value FROM values_table"), /state is unknown/);
});

function createMigrations(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "sinan-migrations-"));
  for (const [filename, sql] of Object.entries(files)) {
    writeFileSync(join(directory, filename), sql, "utf8");
  }
  return directory;
}

function removeDirectory(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}
