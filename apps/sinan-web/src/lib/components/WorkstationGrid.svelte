<script lang="ts">
    import type { ActorState, ActorView } from "sinan-core";
    import WorkstationCard from "./WorkstationCard.svelte";

    /**
     * Office workstation grouping per `web-agent-office.md` §5.2.
     *
     *   Needs attention — failed, quarantined, paused
     *   Working         — running
     *   Idle            — ready, created, restarting
     *   Archive         — terminated (collapsed drawer)
     *
     * This grouping is a *semantic projection* of `ActorState.kind`, not
     * a UI sort preference — the same actors will land in the same
     * group across reloads, devices, and users. `paused` is uniformly
     * "needs attention" in the prototype because the wire shape does
     * not yet distinguish user-pause from system-pause; that split
     * arrives when the decision module lands (§6.1's two `paused`
     * weights).
     *
     * Sections are rendered in fixed attention order (highest first)
     * so the user can answer "do I need to act now?" without scanning
     * the page top-to-bottom.
     */
    let { views }: { views: readonly ActorView[] } = $props();

    const needsAttention = $derived(views.filter((v) => isNeedsAttention(v.state)));
    const working = $derived(views.filter((v) => v.state.kind === "running"));
    const idle = $derived(views.filter((v) => isIdle(v.state)));
    const archived = $derived(views.filter((v) => v.state.kind === "terminated"));

    let archiveOpen = $state(false);

    function isNeedsAttention(state: ActorState): boolean {
        return (
            state.kind === "failed" ||
            state.kind === "quarantined" ||
            state.kind === "paused"
        );
    }

    function isIdle(state: ActorState): boolean {
        return (
            state.kind === "ready" ||
            state.kind === "created" ||
            state.kind === "restarting"
        );
    }
</script>

<div class="space-y-10">
    {#if needsAttention.length > 0}
        <section
            data-section="needs-attention"
            class="relative rounded-2xl border border-status-failed/30 bg-status-failed-tint/40 p-5 shadow-sm"
            aria-labelledby="section-needs-attention"
        >
            <header class="flex items-center gap-3">
                <div class="h-6 w-1 rounded-full bg-section-attention" aria-hidden="true"></div>
                <h2 id="section-needs-attention" class="text-sm font-semibold uppercase tracking-wider text-fg">
                    Needs attention
                </h2>
                <span class="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg-muted">
                    {needsAttention.length}
                </span>
                <span class="text-xs text-fg-subtle">Waiting on a human decision</span>
            </header>
            <div class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {#each needsAttention as view (view.id)}
                    <WorkstationCard {view} />
                {/each}
            </div>
        </section>
    {/if}

    {#if working.length > 0}
        <section
            data-section="working"
            class="relative rounded-2xl border border-status-running/20 bg-status-running-tint/40 p-5 shadow-sm"
            aria-labelledby="section-working"
        >
            <header class="flex items-center gap-3">
                <div class="h-6 w-1 rounded-full bg-section-working" aria-hidden="true"></div>
                <h2 id="section-working" class="text-sm font-semibold uppercase tracking-wider text-fg">
                    Working
                </h2>
                <span class="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg-muted">
                    {working.length}
                </span>
                <span class="text-xs text-fg-subtle">Currently holding a lease</span>
            </header>
            <div class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {#each working as view (view.id)}
                    <WorkstationCard {view} />
                {/each}
            </div>
        </section>
    {/if}

    {#if idle.length > 0}
        <section
            data-section="idle"
            class="relative rounded-2xl border border-divider bg-surface-1 p-5 shadow-sm"
            aria-labelledby="section-idle"
        >
            <header class="flex items-center gap-3">
                <div class="h-6 w-1 rounded-full bg-section-idle" aria-hidden="true"></div>
                <h2 id="section-idle" class="text-sm font-semibold uppercase tracking-wider text-fg">
                    Idle
                </h2>
                <span class="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg-muted">
                    {idle.length}
                </span>
                <span class="text-xs text-fg-subtle">Ready, created, or restarting</span>
            </header>
            <div class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {#each idle as view (view.id)}
                    <WorkstationCard {view} />
                {/each}
            </div>
        </section>
    {/if}

    {#if archived.length > 0}
        <section
            data-section="archive"
            class="relative rounded-2xl border border-dashed border-divider bg-surface-2/40 p-5"
            aria-labelledby="section-archive"
        >
            <button
                type="button"
                class="flex w-full items-center justify-between gap-3 text-left"
                aria-expanded={archiveOpen}
                aria-controls="archive-body"
                onclick={() => (archiveOpen = !archiveOpen)}
            >
                <header class="flex items-center gap-3">
                    <div class="h-6 w-1 rounded-full bg-section-archive" aria-hidden="true"></div>
                    <h2 id="section-archive" class="text-sm font-semibold uppercase tracking-wider text-fg">
                        Archive
                    </h2>
                    <span class="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-xs text-fg-muted">
                        {archived.length}
                    </span>
                    <span class="text-xs text-fg-subtle">{archived.length} terminated</span>
                </header>
                <span class="rounded-md border border-divider bg-surface-1 px-2 py-1 font-mono text-xs text-fg-muted">
                    {archiveOpen ? "hide ▴" : "show ▾"}
                </span>
            </button>
            {#if archiveOpen}
                <div
                    id="archive-body"
                    class="mt-5 grid grid-cols-1 gap-4 opacity-80 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
                >
                    {#each archived as view (view.id)}
                        <WorkstationCard {view} />
                    {/each}
                </div>
            {/if}
        </section>
    {/if}
</div>
