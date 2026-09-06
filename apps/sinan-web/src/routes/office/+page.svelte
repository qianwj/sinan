<script lang="ts">
    import { onMount } from "svelte";
    import type { ActorView } from "sinan-core";
    import AttentionBand from "$lib/components/AttentionBand.svelte";
    import WorkstationGrid from "$lib/components/WorkstationGrid.svelte";

    /**
     * Office page — the only page the prototype ships. The data
     * source is `GET /api/actors`. In dev the Vite mock plugin
     * serves the office fixtures; in production the `sinan-server`
     * handles the same path. Either way the wire shape matches
     * `ActorView`, and no translation layer is needed.
     *
     * State management stays local: the prototype has no SSE
     * subscription, no optimistic updates, and no actor detail view,
     * so the views are a single immutable snapshot for the page's
     * lifetime. A real-time slice will replace this with a store
     * and per-card invalidation.
     */
    let views = $state<readonly ActorView[]>([]);
    let loading = $state(true);
    let error: string | null = $state(null);

    onMount(async () => {
        try {
            const res = await fetch("/api/actors");
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const body = (await res.json()) as { actors: ActorView[] };
            views = body.actors;
        } catch (cause) {
            error = cause instanceof Error ? cause.message : String(cause);
        } finally {
            loading = false;
        }
    });
</script>

<svelte:head>
    <title>Sinan Office</title>
</svelte:head>

{#if loading}
    <p class="p-8 text-fg-muted">Loading office…</p>
{:else if error}
    <div class="p-8">
        <p class="font-semibold text-status-failed">Failed to load office</p>
        <p class="mt-1 font-mono text-xs text-fg-muted">{error}</p>
    </div>
{:else}
    <AttentionBand {views} />
    <main class="mx-auto max-w-7xl px-6 py-8">
        <WorkstationGrid {views} />
    </main>
{/if}
