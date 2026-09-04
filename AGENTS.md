# Repository Guidelines

## Project Structure

Sinan is a TypeScript ESM monorepo managed with npm workspaces. Shared domain code belongs in `packages/sinan-core/`; the runnable server is in `apps/sinan-server/`. Server sources are under `apps/sinan-server/src/`, organized by responsibility (`bootstrap/`, `actors/`, and `persistence/`). SQL migrations live in `apps/sinan-server/migrations/`. Product requirements and architecture decisions are documented in `docs/`; read `docs/requirements.md` before changing behavior and `docs/architecture.md` before changing boundaries. Tests currently live beside the relevant server code, such as `src/persistence/migrate.test.ts`.

## Build, Test, and Development Commands

Run commands from the repository root:

- `npm install` installs all workspace dependencies.
- `npm run dev -w sinan-server` starts the local server and loads `apps/sinan-server/.env.local`.
- `npm run db:migrate -- <path>` applies database migrations; omit the path to use the configured default.
- `npx tsc -p apps/sinan-server/tsconfig.json --noEmit` performs strict server type-checking.
- `node --import tsx --test apps/sinan-server/src/persistence/migrate.test.ts` runs the existing migration tests directly.

Node.js `>=22.5.0` is required because the server uses the built-in `node:sqlite` module. Add workspace scripts when a repeatable command becomes part of normal development; do not rely on undocumented global tools.

## Coding Style and Naming

Use strict TypeScript with ESM imports. Use `import type` for type-only dependencies, narrow indexed values, and avoid `any`. Classes own stateful behavior; use constructor injection and keep constructors free of business logic or I/O. Keep pure transformations as functions. Use `PascalCase` for classes and interfaces, `camelCase` for functions and variables, and descriptive `UPPER_SNAKE_CASE` only for constants. Follow the surrounding file's indentation and quote style, and keep comments focused on non-obvious invariants.

## Testing Guidelines

Name tests `*.test.ts` and place them near the implementation. Use Node's built-in test runner with `tsx`. Cover migration behavior, persistence invariants, recovery paths, and any changed error handling. Run the focused test command plus strict type-checking before submitting changes.

## Commits and Pull Requests

Use the established Conventional Commit pattern, for example `feat(server): add actor recovery` or `chore(project): update workspace config`. Keep commits focused. Pull requests should explain the behavioral change, link the relevant `REQ-*` or architecture section when applicable, list validation commands and results, and call out migration, configuration, or compatibility impacts. Never commit secrets from `.env.local` or local database files.

## Architecture and Configuration Notes

Preserve the documented local-first, single-user boundary and the human as final authority. New capabilities should trace to a requirement ID. Treat SQLite records and append-only events as durable facts; do not silently replace them with in-memory state. Use `SINAN_DB_PATH` for a non-default database location during local testing.
