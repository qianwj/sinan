<script lang="ts">
    import type { ActorView } from "sinan-core";

    /**
     * Top attention band (web-agent-office.md §4.1). For the demo
     * slice we surface only what we can derive from the in-memory
     * fixtures: the actor headcount, the quarantined count (the
     * "异常指示" item), and a synthetic "connected" sync badge. The
     * decision inbox and the focus path arrive with the next slice.
     */
    let { views }: { views: readonly ActorView[] } = $props();

    const total = $derived(views.length);
    const quarantined = $derived(
        views.filter((view) => view.state.kind === "quarantined").length,
    );
    const failed = $derived(views.filter((view) => view.state.kind === "failed").length);
    const attentionCount = $derived(quarantined + failed);
</script>

<header
    class="flex flex-wrap items-center gap-3 border-b border-divider bg-surface-1 px-6 py-3"
    aria-label="Attention summary"
>
    <h1 class="text-lg font-semibold text-fg">Sinan Office</h1>
    <span class="rounded-full bg-canvas px-3 py-1 text-xs text-fg-muted">
        {total} actor{total === 1 ? "" : "s"}
    </span>
    {#if attentionCount > 0}
        <span
            class="rounded-full bg-status-failed px-3 py-1 text-xs font-semibold text-white"
            aria-live="polite"
        >
            {attentionCount} needing attention
        </span>
    {:else}
        <span class="rounded-full bg-status-ready px-3 py-1 text-xs text-white">all clear</span>
    {/if}
    <span class="ml-auto inline-flex items-center gap-2 text-xs text-fg-muted">
        <span
            class="inline-block h-2 w-2 rounded-full bg-status-ready"
            aria-hidden="true"
        ></span>
        connected (mock)
    </span>
</header>
