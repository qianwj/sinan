import assert from "node:assert/strict";
import { test } from "node:test";
import { Database } from "./database.js";

test("run, get and all bind parameters and expose typed query results", () => {
  using database = new Database(":memory:");
  database.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");

  const inserted = database.run("INSERT INTO users (name) VALUES (?)", "Ada");
  assert.equal(inserted.changes, 1);
  assert.equal(database.run("INSERT INTO users (name) VALUES (:name)", { name: "Grace" }).changes, 1);

  const ada = database.get<{ id: number; name: string }>(
    "SELECT id, name FROM users WHERE name = ?",
    "Ada",
  );
  assert.equal(ada.isPresent(), true);
  assert.deepEqual(ada.get(), { id: 1, name: "Ada" });

  const users = database.all<{ id: number; name: string }>(
    "SELECT id, name FROM users ORDER BY id",
  );
  assert.deepEqual(users, [
    { id: 1, name: "Ada" },
    { id: 2, name: "Grace" },
  ]);
});

test("get returns an empty Optional for a missing row and all returns an empty array", () => {
  using database = new Database(":memory:");
  database.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL)");

  assert.equal(database.get("SELECT id FROM items WHERE id = ?", 1).isEmpty(), true);
  assert.deepEqual(database.all("SELECT id FROM items"), []);
});

test("database operations fail clearly after close and close remains idempotent", () => {
  const database = new Database(":memory:");
  database.close();
  database.close();

  assert.throws(() => database.exec("SELECT 1"), /Database is closed/);
  assert.throws(() => database.run("SELECT 1"), /Database is closed/);
  assert.throws(() => database.get("SELECT 1"), /Database is closed/);
  assert.throws(() => database.all("SELECT 1"), /Database is closed/);
});
