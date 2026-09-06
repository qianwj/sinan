import type { ActorEvent } from "../actors/index.js";
import type { ActorId, EventSequence } from "sinan-core";

/**
 * An event plus the metadata needed to deliver it to subscribers without
 * a database round-trip. `eventId` is the row's unique id from
 * `actor_event.event_id`; the SSE layer uses it as the `id:` field so a
 * client that disconnects can resume with `Last-Event-ID`.
 */
export interface PublishedEvent {
    readonly actorId: ActorId;
    readonly sequence: EventSequence;
    readonly eventId: string;
    readonly event: ActorEvent;
}

/**
 * Function called for each event delivered to a subscriber. Errors thrown
 * from the handler are logged but never propagated; a misbehaving
 * subscriber cannot break delivery to its peers.
 */
export type EventHandler = (envelope: PublishedEvent) => void;

/** Disposer returned by `subscribe*`; idempotent. */
export type Unsubscribe = () => void;

/**
 * Fan-out surface for `actor_event` rows. Implementations must be
 * synchronous from the producer's point of view: `publish` returns as
 * soon as the event has been queued for delivery.
 *
 * The in-process implementation used by this slice supports a single
 * process. Cross-process delivery is out of scope until the multi-server
 * question in `actor-runtime.md` §11.4 is resolved.
 */
export interface EventPublisher {
    publish(envelope: PublishedEvent): void;
    /**
     * Subscribe to events for a single actor. The handler is invoked
     * synchronously from `publish` for events that arrive after the
     * subscription is registered. To replay historical events, use
     * `loadHistory` first.
     */
    subscribe(actorId: ActorId, handler: EventHandler): Unsubscribe;
    /**
     * Subscribe to every event the publisher sees. Used by the SSE
     * handler so the office view reflects all actors at once.
     */
    subscribeAll(handler: EventHandler): Unsubscribe;
}

/**
 * Single-process implementation backed by two `Set`s of handlers. The
 * global set and the per-actor set share a single iteration: a publish
 * to actor X fans out to the global set plus the per-actor set for X.
 */
export class InMemoryEventPublisher implements EventPublisher {
    private readonly byActor = new Map<ActorId, Set<EventHandler>>();
    private readonly all = new Set<EventHandler>();

    public publish(envelope: PublishedEvent): void {
        for (const handler of this.all) {
            safeInvoke(handler, envelope);
        }
        const perActor = this.byActor.get(envelope.actorId);
        if (perActor === undefined) return;
        for (const handler of perActor) {
            safeInvoke(handler, envelope);
        }
    }

    public subscribe(actorId: ActorId, handler: EventHandler): Unsubscribe {
        return addHandler(this.byActor, actorId, handler);
    }

    public subscribeAll(handler: EventHandler): Unsubscribe {
        this.all.add(handler);
        return () => {
            this.all.delete(handler);
        };
    }
}

function addHandler(
    map: Map<ActorId, Set<EventHandler>>,
    actorId: ActorId,
    handler: EventHandler,
): Unsubscribe {
    let set = map.get(actorId);
    if (set === undefined) {
        set = new Set();
        map.set(actorId, set);
    }
    set.add(handler);
    return () => {
        const current = map.get(actorId);
        if (current === undefined) return;
        current.delete(handler);
        if (current.size === 0) {
            map.delete(actorId);
        }
    };
}

function safeInvoke(handler: EventHandler, envelope: PublishedEvent): void {
    try {
        handler(envelope);
    } catch (cause) {
        // Subscriber errors must not affect other subscribers or the
        // producer; the SSE handler is the primary consumer and
        // disconnects are the most likely cause.
        console.error("EventPublisher subscriber threw:", cause);
    }
}
