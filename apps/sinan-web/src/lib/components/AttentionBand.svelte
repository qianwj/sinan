<script lang="ts">
    import type { ActorState, ActorView } from "sinan-core";

    /**
     * Top attention band (`web-agent-office.md` §4.1).
     *
     * Surfaces the four signals the user needs to answer "do I need
     * to do anything right now?" without scrolling:
     *
     *   1. Headcount + section counts (per §5.2 grouping)
     *   2. Abnormal indicator — fails loudly when any actor is
     *      `quarantined` or `failed` (highest weight, §6.1)
     *   3. Sync status — the live connection to the data source
     *
     * The decision-inbox count and the current focus path
     * (`web-agent-office.md` §4.1) are reserved slots that arrive in
     * the next slice when the decision module is wired in; they are
     * deliberately omitted from this prototype so the band only shows
     * what the data source actually returns.
     *
     * Per the same section, this band must NOT show unread agent log
     * counts or total uncompleted task counts (§4.1 "不展示") — those
     * are noise that would dilute the attention signal.
     */
    let {
        views,
        connected = true,
    }: {
        views: readonly ActorView[];
        connected?: boolean;
    } = $props();

    const total = $derived(views.length);
    const working = $derived(views.filter((v) => v.state.kind === "running").length);
    const idle = $derived(
        views.filter(
            (v) => v.state.kind === "ready" || v.state.kind === "created" || v.state.kind === "restarting",
        ).length,
    );
    const needsAttention = $derived(
        views.filter(
            (v) =>
                v.state.kind === "failed" ||
                v.state.kind === "quarantined" ||
                v.state.kind === "paused",
        ),
    );

    function isNeedsAttention(state: ActorState): boolean {
        return (
            state.kind === "failed" ||
            state.kind === "quarantined" ||
            state.kind === "paused"
        );
    }
</script>

<header
    class="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-divider bg-surface-1/95 px-6 py-3.5 backdrop-blur"
    aria-label="Attention summary"
>
    <!-- Brand mark. The green dot is the "system is alive" indicator;
         the live connection pill on the right is the data-source
         indicator. They are independent signals. -->
    <div class="flex items-center gap-2">
        <div class="h-2 w-2 rounded-full bg-status-running" aria-hidden="true"></div>
        <h1 class="text-base font-semibold tracking-tight text-fg">Sinan Office</h1>
    </div>

    <!-- Section counts. Per §4.1 these are *attention-shaped* counts,
         not "all agent telemetry" — only the high-attention counts
         are surfaced; total task backlog and unread logs are not. -->
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

    <!-- Abnormal indicator. The single loudest signal on the page:
         "N actors need a human decision". When zero, collapses to a
         quiet "all clear" pill so the band stays visually calm. -->
    {#if needsAttention.length > 0}
        <div
            class="ml-auto flex items-center gap-2 rounded-full bg-status-failed px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-palette-slate-50 shadow-sm"
            aria-live="polite"
            data-state="needs-attention"
        >
            <span
                class="motion-safe:inline-block motion-safe:h-1.5 motion-safe:w-1.5 motion-safe:rounded-full motion-safe:bg-palette-slate-50 motion-safe:animate-pulse"
                aria-hidden="true"
            ></span>
            {needsAttention.length} needing attention
        </div>
    {:else}
        <div
            class="ml-auto flex items-center gap-2 rounded-full bg-status-ready-tint px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-status-ready"
            data-state="all-clear"
        >
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-status-ready" aria-hidden="true"></span>
            all clear
        </div>
    {/if}

    <!-- Sync status. The data source is reachable (or not). The
         prototype wires this to a fixed `connected` prop; the real
         sinan-server will set it from the SSE / fetch health. -->
    <div
        class="flex items-center gap-1.5 text-xs text-fg-subtle"
        title={connected ? "Connected to data source" : "Connection lost"}
    >
        <span
            class="inline-block h-1.5 w-1.5 rounded-full {connected ? 'bg-status-ready' : 'bg-status-failed'}"
            aria-hidden="true"
        ></span>
        {connected ? "connected" : "disconnected"}
    </div>
</header>
