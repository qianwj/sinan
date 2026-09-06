<script lang="ts">
    import { onMount } from "svelte";
    import type { ActorView } from "sinan-core";
    import AttentionBand from "$lib/components/AttentionBand.svelte";
    import WorkstationCard from "$lib/components/WorkstationCard.svelte";

    /**
     * Office page — the only page the demo ships. The data source is
     * `GET /api/actors`. In dev the Vite mock plugin serves the office
     * fixtures; in production the sinan-server handles the same path.
     * Either way the wire shape matches `ActorView`.
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

{#if loading}
    <p class="p-8 text-fg-muted">Loading office…</p>
{:else if error}
    <p class="p-8 text-status-failed">Failed to load office: {error}</p>
{:else}
    <AttentionBand {views} />
    <main class="mx-auto max-w-7xl px-6 py-8">
        <section
            class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            aria-label="Workstations"
        >
            {#each views as view (view.id)}
                <WorkstationCard {view} />
            {/each}
        </section>
    </main>
{/if}
