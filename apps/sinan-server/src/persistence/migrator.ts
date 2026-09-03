import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Database } from "./database.js";

const MIGRATION_FILE_PATTERN = /^(\d+)(?:[_-](.+))?\.sql$/;
const MIGRATION_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at INTEGER NOT NULL
  )
`;

/** A migration loaded from a numbered SQL file. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly filename: string;
  readonly sql: string;
}

/** The result of one migration pass. */
export interface MigrationResult {
  readonly previousVersion: number;
  readonly currentVersion: number;
  readonly applied: readonly number[];
}

interface AppliedMigrationRow {
  readonly version: number | bigint;
  readonly name: string;
}

/** Coordinates migration discovery, validation, and application. */
export class Migrator {
  private readonly database: Database;
  private readonly migrationsDirectory: string;

  /**
   * Creates a migrator. Files and the database are read only when `migrate`
   * is called, keeping construction free of migration side effects.
   */
  public constructor(
    database: Database,
    migrationsDirectory = defaultMigrationsDirectory(),
  ) {
    this.database = database;
    this.migrationsDirectory = resolve(migrationsDirectory);
  }

  /** Applies all pending migrations in ascending version order. */
  public migrate(): MigrationResult {
    const migrations = this.loadMigrations();
    this.ensureMigrationTable();
    const appliedRows = this.readAppliedMigrations();
    const appliedByVersion = this.indexAppliedMigrations(appliedRows);
    const migrationsByVersion = this.indexMigrations(migrations);

    this.validateAppliedMigrations(appliedByVersion, migrationsByVersion);

    const previousVersion = this.highestVersion(appliedByVersion.keys());
    const applied: number[] = [];
    for (const migration of migrations) {
      if (appliedByVersion.has(migration.version)) continue;
      this.applyMigration(migration);
      appliedByVersion.set(migration.version, {
        version: migration.version,
        name: migration.filename,
      });
      applied.push(migration.version);
    }

    return {
      previousVersion,
      currentVersion: this.highestVersion(appliedByVersion.keys()),
      applied,
    };
  }

  private loadMigrations(): Migration[] {
    const entries = readdirSync(this.migrationsDirectory, { withFileTypes: true });
    const migrations: Migration[] = [];
    const versions = new Set<number>();

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
      const match = MIGRATION_FILE_PATTERN.exec(entry.name);
      if (match === null) {
        throw new Error(
          `Invalid migration filename ${entry.name}; expected NNN_name.sql`,
        );
      }

      const version = this.toVersionNumber(Number(match[1]));
      if (versions.has(version)) {
        throw new Error(`Duplicate migration version ${version}`);
      }
      versions.add(version);
      migrations.push({
        version,
        name: match[2] ?? entry.name.slice(0, -4),
        filename: entry.name,
        sql: readFileSync(resolve(this.migrationsDirectory, entry.name), "utf8"),
      });
    }

    migrations.sort((left, right) => left.version - right.version);
    return migrations;
  }

  private ensureMigrationTable(): void {
    this.database.exec(MIGRATION_TABLE_SQL);
  }

  private readAppliedMigrations(): AppliedMigrationRow[] {
    return this.database.all<AppliedMigrationRow>(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    );
  }

  private indexAppliedMigrations(
    rows: readonly AppliedMigrationRow[],
  ): Map<number, AppliedMigrationRow> {
    const indexed = new Map<number, AppliedMigrationRow>();
    for (const row of rows) {
      const version = this.toVersionNumber(row.version);
      if (indexed.has(version)) {
        throw new Error(`Duplicate migration version recorded: ${version}`);
      }
      if (typeof row.name !== "string" || row.name.length === 0) {
        throw new Error(`Migration ${version} has an invalid recorded name`);
      }
      indexed.set(version, { version, name: row.name });
    }
    return indexed;
  }

  private indexMigrations(migrations: readonly Migration[]): Map<number, Migration> {
    return new Map(migrations.map((migration) => [migration.version, migration]));
  }

  private validateAppliedMigrations(
    applied: ReadonlyMap<number, AppliedMigrationRow>,
    migrations: ReadonlyMap<number, Migration>,
  ): void {
    for (const [version, appliedMigration] of applied) {
      const migration = migrations.get(version);
      if (migration === undefined) {
        throw new Error(
          `Applied migration ${version} (${appliedMigration.name}) is missing from ${this.migrationsDirectory}`,
        );
      }
      if (appliedMigration.name !== migration.filename) {
        throw new Error(
          `Migration ${version} was recorded as ${appliedMigration.name}, `
          + `but the file is now ${migration.filename}`,
        );
      }
    }
  }

  private applyMigration(migration: Migration): void {
    try {
      this.database.transaction(() => {
        this.database.exec(migration.sql);
        this.database.run(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
          migration.version,
          migration.filename,
          Date.now(),
        );
      });
    } catch (cause) {
      throw new MigrationError(migration, cause);
    }
  }

  private toVersionNumber(version: number | bigint): number {
    const numericVersion = typeof version === "bigint" ? Number(version) : version;
    if (!Number.isSafeInteger(numericVersion) || numericVersion < 1) {
      throw new Error(`Migration version must be a positive safe integer: ${String(version)}`);
    }
    return numericVersion;
  }

  private highestVersion(versions: Iterable<number>): number {
    let highest = 0;
    for (const version of versions) {
      if (version > highest) highest = version;
    }
    return highest;
  }
}

/** Error type for callers that need to identify the failed migration. */
export class MigrationError extends Error {
  public readonly migration: Migration;

  public constructor(migration: Migration, cause: unknown) {
    const detail = cause instanceof Error ? `: ${cause.message}` : "";
    super(`Failed to apply migration ${migration.filename}${detail}`, { cause });
    this.name = "MigrationError";
    this.migration = migration;
  }
}

function defaultMigrationsDirectory(): string {
  return fileURLToPath(new URL("../../migrations", import.meta.url));
}
