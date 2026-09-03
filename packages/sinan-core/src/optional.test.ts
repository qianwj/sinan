import assert from "node:assert/strict";
import { test } from "node:test";
import { NoSuchElementError, Optional } from "./optional.js";

test("factories distinguish strict and nullable input", () => {
  assert.equal(Optional.of(42).get(), 42);
  assert.equal(Optional.ofNullable(null).isEmpty(), true);
  assert.equal(Optional.ofNullable(undefined).isEmpty(), true);
  assert.throws(() => Optional.of(null), TypeError);
});

test("presence queries and get expose the value state", () => {
  const present = Optional.of("value");
  const empty = Optional.empty<string>();

  assert.equal(present.isPresent(), true);
  assert.equal(present.isEmpty(), false);
  assert.equal(empty.isPresent(), false);
  assert.equal(empty.isEmpty(), true);
  assert.throws(() => empty.get(), NoSuchElementError);
});

test("map, flatMap and filter compose without invoking empty branches", () => {
  let calls = 0;
  const empty = Optional.empty<number>();
  assert.equal(empty.map(() => ++calls).isEmpty(), true);
  assert.equal(calls, 0);

  assert.equal(Optional.of(2).map((value) => value * 3).get(), 6);
  assert.equal(Optional.of(2).map(() => null).isEmpty(), true);
  assert.equal(Optional.of(2).flatMap((value) => Optional.of(value + 1)).get(), 3);
  assert.equal(Optional.of(2).filter((value) => value > 1).get(), 2);
  assert.equal(Optional.of(2).filter((value) => value < 1).isEmpty(), true);
});

test("actions and fallback suppliers are lazy and branch correctly", () => {
  const present = Optional.of("value");
  const empty = Optional.empty<string>();
  let presentCalls = 0;
  let emptyCalls = 0;

  present.ifPresent(() => presentCalls++);
  empty.ifPresent(() => presentCalls++);
  present.ifPresentOrElse(() => presentCalls++, () => emptyCalls++);
  empty.ifPresentOrElse(() => presentCalls++, () => emptyCalls++);

  assert.equal(presentCalls, 2);
  assert.equal(emptyCalls, 1);
  assert.equal(present.orElseGet(() => "fallback"), "value");
  assert.equal(empty.orElseGet(() => "fallback"), "fallback");
  assert.equal(present.or(() => Optional.of("other")).get(), "value");
  assert.equal(empty.or(() => Optional.of("other")).get(), "other");
});

test("orElseThrow, conversions, equality, stringification and iteration are stable", () => {
  const value = Optional.of("value");
  const empty = Optional.empty<string>();
  const customError = new Error("custom");

  assert.equal(value.orElseThrow(), "value");
  assert.throws(() => empty.orElseThrow(() => customError), (error: unknown) => error === customError);
  assert.equal(value.toNullable(), "value");
  assert.equal(empty.toNullable(), null);
  assert.equal(value.toUndefined(), "value");
  assert.equal(empty.toUndefined(), undefined);
  assert.equal(value.equals(Optional.of("value")), true);
  assert.equal(empty.equals(Optional.empty<number>()), true);
  assert.equal(value.equals(Optional.of("other")), false);
  assert.equal(value.toString(), "Optional[value]");
  assert.equal(empty.toString(), "Optional.empty");
  assert.deepEqual([...value], ["value"]);
  assert.deepEqual([...empty], []);
});

