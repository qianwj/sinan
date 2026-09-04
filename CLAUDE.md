# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Sinan (司南) — a local-first, single-user coordination system that lets one person direct a team of AI agents to build products. It captures intent, coordinates tasks through a shared SQLite blackboard, routes human attention to pending decisions, records decisions/events/side-effects for governance and recovery, and persists memory/precedents. The human owns goals and final decisions; agents execute within authorized scopes; Sinan records facts.

Naming: 司南 is the ancient Chinese south-pointing guide — a metaphor for keeping collaborative work pointed at the right goal.

See `README.md` for the product positioning and `docs/` for design.

## Workspace layout

npm workspaces monorepo. TypeScript, ESM, strict (`tsconfig.json` at root).

- `packages/sinan-core/` — shared library workspace. Currently scaffold-only (no source).
- `apps/sinan-server/` — the server runtime. Entry: `src/main.ts`.
- `apps/sinan-server/src/bootstrap/` — application bootstrap (`application.ts` — signal handling, lifecycle).
- `apps/sinan-server/src/actors/` — actor types and manager (scaffold-only).
- `apps/sinan-server/migrations/` — SQL migration files (`NNN_name.sql`). See `docs/actor-schema.sql` for the canonical schema reference.
- `docs/` — design baseline. Start with `docs/requirements.md` (the *why*), then `docs/architecture.md` (the *how it's organized*). `docs/actor-runtime.md` documents the actor execution model. `docs/project_init.md` records how the workspace was bootstrapped.

## Commands

All commands run from the workspace root unless noted. Node ≥ 22.5.0 required (uses built-in `node:sqlite`).

- **Run the server**: `npm run dev -w sinan-server` (loads `apps/sinan-server/.env.local` via tsx; that file currently sets `SINAN_DB_PATH=$HOME/.sinan/data`)
- **Tests**: per-workspace `npm test`. `sinan-server` has no test script wired in `package.json`; if you add one, follow the existing `node --import tsx --test <file>` pattern.

## TypeScript conventions

Inherited from root `tsconfig.json`:

- `module: nodenext`, `target: esnext`, `"type": "module"` per package.
- `verbatimModuleSyntax: true` — use `import type { ... }` for type-only imports; runtime imports of types will fail.
- `noUncheckedIndexedAccess: true` — array/record index reads yield `T | undefined`; narrow before use.
- `exactOptionalPropertyTypes: true` — distinguish `prop?: T` from `prop: T | undefined`.
- `isolatedModules: true` — every file must be self-contained.
- `strict: true`, `noUncheckedSideEffectImports: true`.

Per-workspace `tsconfig.json` files extend the root and set their own `outDir`.

## Architectural invariants (from `docs/`)

When making design changes, follow the layered dependency direction in `docs/architecture.md` §3.2: attention/governance → execution/collaboration/memory → persistence; experience layer never writes domain facts or calls external models directly. Any new capability must trace back to a `REQ-*` ID in `docs/requirements.md`. If you cannot find one, flag it before implementing.

## Object-oriented design

Code is organized around classes that own state and behavior. Before adding a free function or a module-level helper, ask whether the concern belongs on an existing class.

- **Private state by default.** Instance fields are `private` (or `private readonly`) unless they are intentionally part of the public surface. Use TypeScript access modifiers; do not simulate privacy with `_` prefixes or comments.
- **Composition over inheritance.** Build behavior by holding collaborator instances (`Database` owns its `Migrator`) rather than subclassing. Inheritance is reserved for genuine type hierarchies (e.g., actor roles), not for sharing implementation.
- **Constructor injection for collaborators.** Collaborators are passed in via the constructor (`new Migrator(db)`), not looked up from globals or module-level singletons. This keeps dependencies explicit and lets tests substitute fakes.
- **Single responsibility.** One class, one job. If a class is doing both "talk to SQLite" and "decide which migrations to apply", split it. Cross-cutting orchestration belongs in a higher-level class (e.g., `Application`), not in the leaf classes.
- **Classes and interfaces for stateful concerns; free functions only for pure utilities.** Anything that carries state or exposes multiple operations should be a class or interface. Free functions are fine for things like `loadMigrations`, `assertMigrationsAreValid`, `configurePath` — pure transforms with no state.
- **Constructors do the minimum.** Open the resource, hold the dependency, set invariants. No I/O, no logging, no business logic in the constructor body itself; defer to a method that the caller invokes explicitly (e.g., `application.run()` → `application.onStart()`).
- **Domain types are typed.** `ActorRole`, `MigrateOptions`, `MigrationResult` etc. live as `type`/`interface`/`readonly` object shapes near the class that uses them. Avoid `any`; prefer discriminated unions over loose records.
