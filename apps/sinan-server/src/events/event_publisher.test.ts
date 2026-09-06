import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryEventPublisher } from "./event_publisher.js";
import type { PublishedEvent } from "./event_publisher.js";

function envelope(overrides: Partial<PublishedEvent> = {}): PublishedEvent {
    return {
        actorId: "a-1",
        sequence: 1,
        eventId: "evt-1",
        event: {
            kind: "state-changed",
            sequence: 1,
            from: { kind: "created" },
            to: { kind: "ready" },
            cause: { kind: "command", command: "init" },
            at: 1_000,
        },
        ...overrides,
    };
}

test("publish delivers to subscribeAll handlers", () => {
    const publisher = new InMemoryEventPublisher();
    const seen: PublishedEvent[] = [];
    publisher.subscribeAll((e) => seen.push(e));
    const evt = envelope();
    publisher.publish(evt);
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.eventId, "evt-1");
});

test("subscribe delivers only events for the matching actor", () => {
    const publisher = new InMemoryEventPublisher();
    const seen: PublishedEvent[] = [];
    publisher.subscribe("a-1", (e) => seen.push(e));
    publisher.publish(envelope({ actorId: "a-1", eventId: "evt-1" }));
    publisher.publish(envelope({ actorId: "a-2", eventId: "evt-2" }));
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.eventId, "evt-1");
});

test("subscribeAll handlers also receive per-actor events", () => {
    const publisher = new InMemoryEventPublisher();
    const all: PublishedEvent[] = [];
    const per: PublishedEvent[] = [];
    publisher.subscribeAll((e) => all.push(e));
    publisher.subscribe("a-1", (e) => per.push(e));
    publisher.publish(envelope({ actorId: "a-1" }));
    assert.equal(all.length, 1);
    assert.equal(per.length, 1);
});

test("unsubscribe stops further deliveries for both subscribe and subscribeAll", () => {
    const publisher = new InMemoryEventPublisher();
    let count = 0;
    const offAll = publisher.subscribeAll(() => { count += 1; });
    const offPer = publisher.subscribe("a-1", () => { count += 1; });
    publisher.publish(envelope({ actorId: "a-1" }));
    assert.equal(count, 2);
    offAll();
    offPer();
    publisher.publish(envelope({ actorId: "a-1" }));
    assert.equal(count, 2);
});

test("subscriber exceptions are caught and do not affect other subscribers", () => {
    const publisher = new InMemoryEventPublisher();
    let okSeen = false;
    publisher.subscribeAll(() => { throw new Error("boom"); });
    publisher.subscribeAll(() => { okSeen = true; });
    // Suppress the console.error noise that the publisher emits on a throw.
    const originalError = console.error;
    console.error = () => undefined;
    try {
        publisher.publish(envelope());
    } finally {
        console.error = originalError;
    }
    assert.equal(okSeen, true);
});
