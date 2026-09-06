# sinan-web

Single-user office UI for the Sinan agent coordination system. The
prototype renders the central workstation grid described in
[`docs/web-agent-office.md`](../../docs/web-agent-office.md) §5, served
by a Vite dev-only mock plugin; the same components run against the
real `sinan-server` once it is wired up.

This workspace was rebuilt from scratch on 2026-09-07. The previous
prototype carried a large dead-code 3D CSS scene (`WorkstationScene3D`)
that drifted from the design doc; that scene has been removed and the
remaining components have been tightened against the spec.

## Setup

This is a workspace inside the Sinan monorepo. Dependencies are managed
at the repo root, so installs always run from there:

```sh
# from the repo root
npm install              # installs root + every workspace
npm install -w sinan-web # installs only this workspace (use this when
                         # adding a new dep to apps/sinan-web)
```

Never `cd` into `apps/sinan-web` to run `npm install` — the lockfile
lives at the root, and a nested install would diverge it.

## Dev

```sh
# from the repo root
npm run -w sinan-web dev
```

Vite serves the SPA on `http://localhost:5173/` and a mock API at:

- `GET /api/actors` — returns `{ actors: ActorView[] }` from
  `src/lib/fixtures.ts`
- `GET /api/health` — returns counts derived from the fixtures

The mock plugin (`vite/mockApi.ts`) is dev-only (`apply: "serve"`), so
the static `build/` does not include the mock endpoints. In
production, `sinan-server` handles the same paths.

When the real `sinan-server` is running, point the office at it by
adding a Vite proxy in `vite.config.ts` (see
[`docs/web-tech-stack.md`](../../docs/web-tech-stack.md) §4.1). The
components themselves do not change.

## Type sharing

`ActorRole` / `ActorStateKind` / `ActorState` / `ActorCommand` /
`RestartPolicy` / `ActorView` / `ActorConfig` live in the
`sinan-core` package — they are shared verbatim with `sinan-server`.
Always import them from `"sinan-core"`, never re-declare locally.

## What's in the prototype

The prototype covers §5 of `web-agent-office.md` (workstation view) and
§4.1 (top attention band) only. Everything else is intentionally out
of scope and arrives in follow-up slices that reuse the same wire
shape.

- `/` redirects to `/office` (`src/routes/+page.svelte`)
- `/office` lists workstation cards (`src/routes/office/+page.svelte`)
- `AttentionBand` shows headcount, attention count, and a mock
  "connected" pill (`src/lib/components/AttentionBand.svelte`,
  per `web-agent-office.md` §4.1)
- `WorkstationGrid` groups cards by `ActorState.kind` into
  `Needs attention` / `Working` / `Idle` and a collapsed `Archive`
  drawer (`src/lib/components/WorkstationGrid.svelte`, per §5.2)
- `WorkstationCard` renders one actor with a state stripe, the D-05
  geometric character, identity row, detail block, and meta grid
  (`src/lib/components/WorkstationCard.svelte`, per §5.1)
- `CharacterAvatar` draws the 96×96 geometric figure and role-specific
  prop (`src/lib/components/CharacterAvatar.svelte`, per §D-05)
- `ActorStateBadge` colour-codes the lifecycle state
  (`src/lib/components/ActorStateBadge.svelte`)

Out of scope (each a follow-up slice): decision inbox, event history,
command panel, actor detail modal, SSE subscription, server-persisted
user preferences (§5.5), drag-to-reorder (§5.3), 3D/CSS scenes, dark
theme polish.
