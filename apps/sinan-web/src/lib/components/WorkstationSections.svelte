<script lang="ts">
    import type { ActorView, ActorState } from "sinan-core";
    import WorkstationCard from "./WorkstationCard.svelte";

    /**
     * Office view layout (web-agent-office.md §5.2).
     *
     *   需介入    — failed, quarantined, paused (operator-attention states)
     *   正在工作  — running (currently holding a lease)
     *   待命中    — ready, created, restarting
     *   归档      — terminated (collapsed archive drawer)
     *
     * `terminated` is hidden from the main view by default (`§5.2`);
     * the drawer opens on click. `restarting` is rendered in 待命中
     * with no extra hint (the ActorStateBadge already flags it).
     *
     * The grouping is a semantic projection of `ActorState.kind`, not
     * a UI sort preference.
     */
    let { views }: { views: readonly ActorView[] } = $props();

    const needsAttention = $derived(views.filter((v) => isNeedsAttention(v.state)));
    const working = $derived(views.filter((v) => v.state.kind === "running"));
    const idle = $derived(views.filter((v) => isIdle(v.state)));
    const archived = $derived(views.filter((v) => v.state.kind === "terminated"));

    let archiveOpen = $state(false);

    function isNeedsAttention(state: ActorState): boolean {
        return state.kind === "failed" || state.kind === "quarantined" || state.kind === "paused";
    }

    function isIdle(state: ActorState): boolean {
        return state.kind === "ready" || state.kind === "created" || state.kind === "restarting";
    }

    function headerColor(emphasis: "danger" | "info" | "muted"): string {
        switch (emphasis) {
            case "danger":
                return "border-status-failed text-status-failed";
            case "info":
                return "border-status-running text-status-running";
            case "muted":
                return "border-divider text-fg-subtle";
        }
    }
</script>

<section class="space-y-8">
    {#if needsAttention.length > 0}
        <div data-section="needs-attention">
            <header class="flex items-baseline gap-3 border-b-2 {headerColor('danger')} pb-1">
                <h2 class="font-mono text-sm font-semibold uppercase tracking-wider">Needs attention</h2>
                <span class="font-mono text-xs text-fg-subtle">{needsAttention.length}</span>
            </header>
            <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {#each needsAttention as view (view.id)}
                    <WorkstationCard {view} />
                {/each}
            </div>
        </div>
    {/if}

    {#if working.length > 0}
        <div data-section="working">
            <header class="flex items-baseline gap-3 border-b-2 {headerColor('info')} pb-1">
                <h2 class="font-mono text-sm font-semibold uppercase tracking-wider">Working</h2>
                <span class="font-mono text-xs text-fg-subtle">{working.length}</span>
            </header>
            <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {#each working as view (view.id)}
                    <WorkstationCard {view} />
                {/each}
            </div>
        </div>
    {/if}

    {#if idle.length > 0}
        <div data-section="idle">
            <header class="flex items-baseline gap-3 border-b-2 {headerColor('muted')} pb-1">
                <h2 class="font-mono text-sm font-semibold uppercase tracking-wider">Idle</h2>
                <span class="font-mono text-xs text-fg-subtle">{idle.length}</span>
            </header>
            <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {#each idle as view (view.id)}
                    <WorkstationCard {view} />
                {/each}
            </div>
        </div>
    {/if}

    {#if archived.length > 0}
        <div data-section="archive">
            <button
                type="button"
                class="flex w-full items-center justify-between rounded-md border border-divider bg-canvas px-4 py-2 text-left text-sm text-fg-muted hover:bg-surface-1"
                aria-expanded={archiveOpen}
                onclick={() => (archiveOpen = !archiveOpen)}
            >
                <span class="font-mono uppercase tracking-wide text-fg-subtle">
                    Archive · {archived.length} terminated
                </span>
                <span class="text-fg-subtle">{archiveOpen ? "▾" : "▸"}</span>
            </button>
            {#if archiveOpen}
                <div class="mt-3 grid grid-cols-1 gap-4 opacity-70 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                    {#each archived as view (view.id)}
                        <WorkstationCard {view} />
                    {/each}
                </div>
            {/if}
        </div>
    {/if}
</section>
