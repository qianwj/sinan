<script lang="ts">
    import type { ActorView, ActorState } from "sinan-core";

    /**
     * Top attention band (web-agent-office.md §4.1). Surfaces
     * the counts that the user needs to know "do I need to do
     * anything right now?" without scrolling. For the demo slice
     * we derive every value from the in-memory actor views; the
     * decision inbox and the focus path arrive with the next slice.
     */
    let { views }: { views: readonly ActorView[] } = $props();

    const total = $derived(views.length);
    const needsAttention = $derived(
        views.filter((v) => isNeedsAttention(v.state)).length,
    );
    const working = $derived(views.filter((v) => v.state.kind === "running").length);
    const idle = $derived(
        views.filter(
            (v) => v.state.kind === "ready" || v.state.kind === "created" || v.state.kind === "restarting",
        ).length,
    );

    function isNeedsAttention(state: ActorState): boolean {
        return state.kind === "failed" || state.kind === "quarantined" || state.kind === "paused";
    }
</script>

<header
    class="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-divider bg-surface-1/95 px-6 py-3.5 backdrop-blur"
    aria-label="Attention summary"
>
    <div class="flex items-center gap-2">
        <div class="h-2 w-2 rounded-full bg-status-running" aria-hidden="true"></div>
        <h1 class="text-base font-semibold tracking-tight text-fg">Sinan Office</h1>
    </div>

    <div class="ml-2 flex items-center gap-2 text-xs text-fg-muted">
        <span class="rounded-md border border-divider bg-canvas px-2 py-1 font-mono">
            {total} actor{total === 1 ? "" : "s"}
        </span>
        <span class="rounded-md border border-divider bg-canvas px-2 py-1 font-mono">
            {working} working
        </span>
        <span class="rounded-md border border-divider bg-canvas px-2 py-1 font-mono">
            {idle} idle
        </span>
    </div>

    {#if needsAttention > 0}
        <div
            class="ml-auto flex items-center gap-2 rounded-full bg-status-failed px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-palette-slate-50 shadow-sm"
            aria-live="polite"
        >
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-palette-slate-50 animate-pulse" aria-hidden="true"></span>
            {needsAttention} needing attention
        </div>
    {:else}
        <div
            class="ml-auto flex items-center gap-2 rounded-full bg-status-ready-tint px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-status-ready"
        >
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-status-ready"></span>
            all clear
        </div>
    {/if}

    <div class="ml-0 flex items-center gap-1.5 text-xs text-fg-subtle" title="Vite mock server">
        <span class="inline-block h-1.5 w-1.5 rounded-full bg-status-ready"></span>
        connected
    </div>
</header>
