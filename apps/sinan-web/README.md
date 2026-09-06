# sinan-web

Single-user office UI for the Sinan agent coordination system. The
demo slice renders the central workstation grid (per
`docs/web-agent-office.md` §5) with mock data served by a Vite
dev-only plugin; the same components will run against the real
`sinan-server` once it is wired up.

## Setup

This is a workspace inside the Sinan monorepo. All dependencies are
managed at the repo root, so installs run from there:

```sh
# from the repo root
npm install              # installs root + every workspace
npm install -w sinan-web # installs only the web workspace (use this to
                         # add a new dep to apps/sinan-web)
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
adding a Vite proxy in `vite.config.ts` (see `docs/web-tech-stack.md`
§4.1). The components themselves do not change.

## Type sharing

`ActorRole` / `ActorStateKind` / `ActorState` / `ActorCommand` /
`RestartPolicy` / `ActorView` / `ActorConfig` live in the
`sinan-core` package — they are shared verbatim with `sinan-server`.
Always import them from `"sinan-core"`, never re-declare locally.

## What's in the demo slice

- `/` redirects to `/office` (`src/routes/+page.svelte`)
- `/office` lists workstation cards (`src/routes/office/+page.svelte`)
- `AttentionBand` shows the headcount, attention count, and a
  mock "connected" pill (`src/lib/components/AttentionBand.svelte`)
- `WorkstationCard` renders one actor with a `ActorStateBadge`
  and the per-actor summary (`src/lib/components/WorkstationCard.svelte`)
- `ActorStateBadge` colour-codes the lifecycle state
  (`src/lib/components/ActorStateBadge.svelte`)

Out of scope for the demo: decision inbox, event history, command
panel, SSE subscription, dark theme polish. Each of those is a
follow-up slice that reuses the same fixture / wire shape.
