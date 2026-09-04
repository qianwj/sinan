# Core and Database Usage

This page shows the shared `Optional` type and the server's SQLite wrapper in
the form used by the current TypeScript/ESM workspace.

## Optional

Use `of` when a value must be present, and `ofNullable` when `null` or
`undefined` means that no value was found:

```ts
import { Optional } from "sinan-core";

const configuredName = Optional.ofNullable(process.env.ACTOR_NAME)
  .map((name) => name.trim())
  .filter((name) => name.length > 0)
  .orElse("default-actor");

const requiredToken = Optional.of(process.env.REQUIRED_TOKEN).orElseThrow(
  () => new Error("REQUIRED_TOKEN is missing"),
);
```

`map` is for a normal transformation. Use `flatMap` when the transformation
already returns an `Optional`:

```ts
interface Actor {
  id: string;
  name: string;
}

declare function findActor(id: string): Optional<Actor>;

const actorName = findActor("actor-1")
  .flatMap((actor) => findActor(actor.id))
  .map((actor) => actor.name)
  .orElse("unknown");
```

When an API needs the traditional representation, convert explicitly with
`toNullable()` or `toUndefined()`:

```ts
const nullableValue: string | null = Optional.ofNullable(value).toNullable();
const optionalValue: string | undefined = Optional.ofNullable(value).toUndefined();
```

Here `value` is any value with the type `string | undefined` (for example, a
value read from an optional configuration field).

## Database

`Database` uses `node:sqlite` prepared statements. Bind values as parameters;
do not interpolate user input into SQL text. `get` returns an `Optional`, while
`all` always returns an array:

```ts
import { Database } from "../apps/sinan-server/src/persistence/database.js";

using database = new Database(":memory:");
database.exec(`
  CREATE TABLE actor_config (
    id TEXT PRIMARY KEY,
    state_kind TEXT NOT NULL
  )
`);

database.run(
  "INSERT INTO actor_config (id, state_kind) VALUES (:id, :stateKind)",
  { id: "actor-1", stateKind: "ready" },
);

const actor = database.get<{ id: string; stateKind: string }>(
  "SELECT id, state_kind AS stateKind FROM actor_config WHERE id = ?",
  "actor-1",
);

actor.ifPresent(({ id, stateKind }) => {
  console.log(`${id}: ${stateKind}`);
});

const actors = database.all<{ id: string; stateKind: string }>(
  "SELECT id, state_kind AS stateKind FROM actor_config ORDER BY id",
);
```

Use `transaction` for related writes that must commit or roll back together.
The callback must be synchronous; nested transactions and `async` callbacks are
rejected explicitly:

```ts
database.transaction(() => {
  database.run("INSERT INTO actor_event (actor_id) VALUES (?)", "actor-1");
  database.run(
    "UPDATE actor_config SET state_kind = ? WHERE id = ?",
    "ready",
    "actor-1",
  );
});
```

For a file-backed database, pass a path or set `SINAN_DB_PATH`. The default is
`~/.sinan/sinan.db`:

```ts
using database = new Database();
const pending = database.all("SELECT id FROM actor_config WHERE state_kind = ?", "pending");
```

The `using` declaration calls `Database[Symbol.dispose]()` when the scope ends.
Call `database.close()` directly when explicit lifecycle control is preferred.
