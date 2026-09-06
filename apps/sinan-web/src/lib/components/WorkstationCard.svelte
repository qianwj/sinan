<script lang="ts">
    import type { ActorRole, ActorState, ActorView } from "sinan-core";
    import ActorStateBadge from "./ActorStateBadge.svelte";
    import CharacterAvatar from "./CharacterAvatar.svelte";

    /**
     * One workstation = one actor projection
     * (`web-agent-office.md` §5.1).
     *
     * Card anatomy (top → bottom):
     *   1. Top status stripe (1px)        — state color (§6.1)
     *   2. Scene zone                     — role-colored halo + 96×96
     *                                       D-05 character with role
     *                                       prop (§5.3 + §D-05). The
     *                                       halo carries the *identity*
     *                                       color (role); the stripe
     *                                       carries the *state* color
     *                                       — they are independent
     *                                       (§5.3 "身份色与状态色独立").
     *   3. Identity row                   — name + role label + badge
     *   4. Detail block                   — state-specific one-liner
     *                                       (per §6.3 "who did what
     *                                       to what, and what is next")
     *   5. Meta grid                      — id, workspace, policy,
     *                                       last event timestamp
     *
     * High-attention states (failed, quarantined) get a colored border
     * in addition to the stripe + text. Color is never the only signal
     * (§6.1).
     */
    let { view }: { view: ActorView } = $props();

    const roleLabel = $derived(roleLabelFor(view.config.role));
    const roleClass = $derived(roleClassFor(view.config.role));
    const stripeClass = $derived(stripeFor(view.state));
    const tintClass = $derived(tintFor(view.state));
    const detail = $derived(detailFor(view));
    const taskLine = $derived(taskLineFor(view));
    const relativeLastEvent = $derived(
        view.lastEventAt === null ? "never" : relativeTime(view.lastEventAt),
    );

    const isQuarantined = $derived(view.state.kind === "quarantined");
    const isFailed = $derived(view.state.kind === "failed");
    const isHighAttention = $derived(isQuarantined || isFailed);

    function roleLabelFor(role: ActorRole): string {
        switch (role) {
            case "product_manager":         return "Product";
            case "designer":                return "Design";
            case "development_engineer":    return "Engineer";
            case "qa_engineer":             return "QA";
            case "devops_engineer":         return "DevOps";
        }
    }

    function roleClassFor(role: ActorRole): string {
        switch (role) {
            case "product_manager":         return "bg-role-pm";
            case "designer":                return "bg-role-designer";
            case "development_engineer":    return "bg-role-developer";
            case "qa_engineer":             return "bg-role-qa";
            case "devops_engineer":         return "bg-role-devops";
        }
    }

    function stripeFor(state: ActorState): string {
        switch (state.kind) {
            case "ready":        return "bg-status-ready";
            case "running":      return "bg-status-running";
            case "paused":       return "bg-status-paused";
            case "failed":       return "bg-status-failed";
            case "restarting":   return "bg-status-restarting";
            case "quarantined":  return "bg-status-quarantined";
            case "terminated":   return "bg-status-terminated";
            case "created":
            case "initializing": return "bg-status-running";
        }
    }

    function tintFor(state: ActorState): string {
        switch (state.kind) {
            case "ready":        return "bg-status-ready-tint";
            case "running":      return "bg-status-running-tint";
            case "paused":       return "bg-status-paused-tint";
            case "failed":       return "bg-status-failed-tint";
            case "restarting":   return "bg-status-restarting-tint";
            case "quarantined":  return "bg-status-quarantined-tint";
            case "terminated":   return "bg-status-terminated-tint";
            case "created":
            case "initializing": return "bg-status-running-tint";
        }
    }

    /**
     * Per §6.3, the detail line carries the causal chain: who did what
     * to what, and what is next. We only have the actor + state in the
     * prototype's wire shape, so the line collapses to "the state
     * reason + the next step".
     */
    function detailFor(view: ActorView): string {
        const s = view.state;
        switch (s.kind) {
            case "running":
                return `holding a lease on task ${s.taskId}`;
            case "paused":
                return s.reason;
            case "failed":
                return s.error.message;
            case "quarantined":
                return s.reason;
            case "restarting":
                return s.fromCheckpoint === null
                    ? "restarting from scratch"
                    : `restarting from ${s.fromCheckpoint}`;
            case "terminated":
                return s.clean ? "clean shutdown" : "unclean shutdown";
            case "ready":
            case "created":
            case "initializing":
                return "idle — waiting for a task";
        }
    }

    /** "Current task = taskId + one-line goal" (§5.1). The one-line
     *  goal comes from the task module, which is out of scope for the
     *  prototype; we show the taskId and a placeholder line so the
     *  slot is visibly reserved. */
    function taskLineFor(view: ActorView): { id: string; goal: string } | null {
        if (view.state.kind !== "running") return null;
        return {
            id: view.state.taskId,
            goal: "one-line goal will arrive with the task module",
        };
    }

    function relativeTime(at: number): string {
        const diffMs = Date.now() - at;
        if (diffMs < 0) return "just now";
        const sec = Math.floor(diffMs / 1000);
        if (sec < 60) return `${sec}s ago`;
        const min = Math.floor(sec / 60);
        if (min < 60) return `${min}m ago`;
        const hr = Math.floor(min / 60);
        if (hr < 24) return `${hr}h ago`;
        const day = Math.floor(hr / 24);
        return `${day}d ago`;
    }
</script>

<article
    class="group relative flex flex-col overflow-hidden rounded-xl border bg-surface-1 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)] transition hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.06)] focus-within:ring-2 focus-within:ring-status-running focus-within:ring-offset-2"
    class:border-status-quarantined={isQuarantined}
    class:border-status-failed={isFailed}
    class:border-divider={!isHighAttention}
    data-state={view.state.kind}
    data-actor-id={view.id}
>
    <!-- (1) Top status stripe — the state color, always visible. -->
    <div class="h-1 w-full {stripeClass}" aria-hidden="true"></div>

    <!-- (2) Scene zone — role-tinted background + D-05 character.
         The character color (currentColor) comes from a parent text
         token the caller sets, so each role reads as a distinct spot
         in the office floor (§5.3). -->
    <div class="relative flex items-center justify-center {tintClass} px-5 pt-5 pb-4">
        <div
            class="relative flex h-28 w-28 items-center justify-center rounded-full {roleClass} ring-4 ring-surface-1 shadow-[inset_0_-3px_0_rgba(15,23,42,0.12),0_2px_4px_rgba(15,23,42,0.08)] text-white"
            aria-hidden="true"
        >
            <CharacterAvatar
                role={view.config.role}
                state={view.state}
                title={`${view.config.name}, ${roleLabel}`}
            />
        </div>
    </div>

    <!-- (3) Identity row. -->
    <div class="flex items-center gap-2 px-5 pt-3">
        <p class="truncate text-base font-semibold leading-tight text-fg">
            {view.config.name}
        </p>
        <span class="shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-subtle">
            {roleLabel}
        </span>
        <div class="ml-auto">
            <ActorStateBadge state={view.state} />
        </div>
    </div>

    <!-- (4) Detail block — state-tinted, state-specific one-liner. -->
    <div class="px-5 pt-3 pb-2">
        <p
            class="text-sm leading-relaxed text-fg"
            class:font-semibold={isHighAttention}
            class:text-status-failed={isFailed}
            class:text-status-quarantined={isQuarantined}
        >
            {detail}
        </p>
        {#if taskLine}
            <div class="mt-2 flex items-center gap-2 text-xs">
                <span class="rounded-md border border-divider bg-canvas px-1.5 py-0.5 font-mono text-fg">
                    {taskLine.id}
                </span>
                <span class="text-fg-subtle">{taskLine.goal}</span>
            </div>
        {/if}
    </div>

    <!-- (5) Meta grid. -->
    <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-divider px-5 py-3 text-xs text-fg-muted">
        <dt class="font-mono uppercase tracking-wide text-fg-subtle">id</dt>
        <dd class="truncate font-mono text-fg">{view.id}</dd>
        <dt class="font-mono uppercase tracking-wide text-fg-subtle">workspace</dt>
        <dd class="truncate font-mono text-fg">{view.config.workspace}</dd>
        <dt class="font-mono uppercase tracking-wide text-fg-subtle">policy</dt>
        <dd class="truncate font-mono text-fg">{view.config.policy.kind}</dd>
        <dt class="font-mono uppercase tracking-wide text-fg-subtle">last event</dt>
        <dd class="truncate font-mono text-fg">{relativeLastEvent}</dd>
    </dl>
</article>
