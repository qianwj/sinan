import assert from "node:assert/strict";
import { test } from "node:test";
import { IdempotencyStore } from "./idempotency.js";

const SAMPLE_RESPONSE = {
    status: 201,
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify({ id: "actor-1" }),
};

test("set then get returns the same response", () => {
    const store = new IdempotencyStore(60_000);
    store.set("k-1", SAMPLE_RESPONSE);
    const replayed = store.get("k-1").orElseThrow();
    assert.equal(replayed.status, SAMPLE_RESPONSE.status);
    assert.equal(replayed.body, SAMPLE_RESPONSE.body);
    assert.equal(replayed.headers["content-type"], SAMPLE_RESPONSE.headers["content-type"]);
});

test("get on an unknown key returns empty", () => {
    const store = new IdempotencyStore(60_000);
    assert.equal(store.get("nope").isPresent(), false);
});

test("entries expire past the TTL", () => {
    let now = 1_000_000;
    const store = new IdempotencyStore(1_000, () => now);
    store.set("k-1", SAMPLE_RESPONSE);
    now += 999;
    assert.equal(store.get("k-1").isPresent(), true);
    now += 1;
    assert.equal(store.get("k-1").isPresent(), false);
});

test("set sweeps expired entries before inserting", () => {
    let now = 1_000_000;
    const store = new IdempotencyStore(1_000, () => now);
    store.set("k-1", SAMPLE_RESPONSE);
    now += 2_000;
    assert.equal(store.size, 1, "expired entry is not yet swept");
    store.set("k-2", SAMPLE_RESPONSE);
    assert.equal(store.size, 1, "k-1 was swept during set");
    assert.equal(store.get("k-1").isPresent(), false);
    assert.equal(store.get("k-2").isPresent(), true);
});

test("set overwrites a non-expired entry with the same key", () => {
    const store = new IdempotencyStore(60_000);
    const first = { status: 201, headers: {}, body: "first" };
    const second = { status: 201, headers: {}, body: "second" };
    store.set("k-1", first);
    store.set("k-1", second);
    assert.equal(store.size, 1);
    assert.equal(store.get("k-1").get().body, "second");
});
