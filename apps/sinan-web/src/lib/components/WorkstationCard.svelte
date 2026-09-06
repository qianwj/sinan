<script lang="ts">
    import type { ActorRole, ActorView, ActorState } from "sinan-core";
    import ActorStateBadge from "./ActorStateBadge.svelte";
    import CharacterAvatar from "./CharacterAvatar.svelte";
    import { lookupTask } from "$lib/fixtures.js";

    /**
     * One workstation = one actor (web-agent-office.md §5.1).
     *
     * Card anatomy (top → bottom):
     *   - top status stripe (1px) — actor state color
     *   - scene zone: desk surface + 64x64 SVG character with role prop
     *     (web-agent-office.md §D-05). The avatar frame is the role
     *     identity color; the prop "moves" in a state-appropriate way
     *     (typing / drawing / scanning / tapping). The avatar itself
     *     never animates.
     *   - identity row: actor name + role label + state badge
     *   - detail block: state-specific one-liner (per §6.3 "who did
     *     what to what, and what is next"); status-tinted background
     *   - meta grid: id, workspace, policy, last event
     */
    let { view }: { view: ActorView } = $props();

    const roleLabel = $derived(roleLabelFor(view.config.role));
    const roleClass = $derived(roleClassFor(view.config.role));
    const statusClass = $derived(statusClassFor(view.state));
    const statusTint = $derived(statusTintFor(view.state));
    const statusText = $derived(statusTextFor(view.state));
    const detail = $derived(detailFor(view));
    const task = $derived(taskFor(view.state));
    const isQuarantined = $derived(view.state.kind === "quarantined");
    const isFailed = $derived(view.state.kind === "failed");
    const isHighAttention = $derived(isQuarantined || isFailed);
    const relativeLastEvent = $derived(
        view.lastEventAt === null ? "never" : relativeTime(view.lastEventAt),
    );

    function roleLabelFor(role: ActorRole): string {
        switch (role) {
            case "product_manager":
                return "Product";
            case "designer":
                return "Design";
            case "development_engineer":
                return "Engineer";
            case "qa_engineer":
                return "QA";
            case "devops_engineer":
                return "DevOps";
        }
    }

    function roleClassFor(role: ActorRole): string {
        switch (role) {
            case "product_manager":
                return "bg-role-pm";
            case "designer":
                return "bg-role-designer";
            case "development_engineer":
                return "bg-role-developer";
            case "qa_engineer":
                return "bg-role-qa";
            case "devops_engineer":
                return "bg-role-devops";
        }
    }

    function statusClassFor(state: ActorState): string {
        switch (state.kind) {
            case "ready":
                return "bg-status-ready";
            case "running":
                return "bg-status-running";
            case "paused":
                return "bg-status-paused";
            case "failed":
                return "bg-status-failed";
            case "restarting":
                return "bg-status-restarting";
            case "quarantined":
                return "bg-status-quarantined";
            case "terminated":
            case "created":
            case "initializing":
                return "bg-status-terminated";
        }
    }

    function statusTintFor(state: ActorState): string {
        switch (state.kind) {
            case "ready":
                return "bg-status-ready-tint";
            case "running":
                return "bg-status-running-tint";
            case "paused":
                return "bg-status-paused-tint";
            case "failed":
                return "bg-status-failed-tint";
            case "restarting":
                return "bg-status-restarting-tint";
            case "quarantined":
                return "bg-status-quarantined-tint";
            case "terminated":
            case "created":
            case "initializing":
                return "bg-status-terminated-tint";
        }
    }

    function statusTextFor(state: ActorState): string {
        switch (state.kind) {
            case "ready":
            case "created":
            case "initializing":
                return "at the desk";
            case "running":
                return "heads down";
            case "paused":
                return "stepped away";
            case "failed":
                return "needs a hand";
            case "restarting":
                return "coming back";
            case "quarantined":
                return "locked — needs review";
            case "terminated":
                return "archived";
        }
    }

    function detailFor(view: ActorView): string {
        const state = view.state;
        switch (state.kind) {
            case "running": {
                const t = lookupTask(state.taskId);
                return t?.title ?? `task ${state.taskId}`;
            }
            case "paused":
                return state.reason;
            case "failed":
                return state.error.message;
            case "quarantined":
                return state.reason;
            case "restarting":
                return state.fromCheckpoint === null
                    ? "restarting from scratch"
                    : `restarting from ${state.fromCheckpoint}`;
            case "terminated":
                return state.clean ? "clean shutdown" : "unclean shutdown";
            case "ready":
            case "created":
            case "initializing":
                return "idle — waiting for a task";
        }
    }

    function taskFor(state: ActorState): { id: string; requirement: string | null; title: string } | null {
        if (state.kind !== "running") return null;
        const summary = lookupTask(state.taskId);
        return {
            id: state.taskId,
            requirement: summary?.requirement ?? null,
            title: summary?.title ?? `task ${state.taskId}`,
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
>
    <!-- Top status stripe (per §6.1) -->
    <div class="h-1 w-full {statusClass}" aria-hidden="true"></div>

    <!--
        Scene zone — the workstation "photo".
        The avatar frame is the role identity color; the prop is drawn
        inside the SVG. The desk surface is a subtle role-tinted
        background so each workstation reads as a distinct spot in the
        office (D-05 + §5.3).
    -->
    <div
        class="relative flex items-center justify-center {statusTint} px-5 pb-4 pt-5"
        data-scene="true"
    >
        <!-- Role-colored halo behind the avatar so each workstation
             reads as a distinct spot in the office floor. -->
        <div
            class="relative flex h-24 w-24 items-center justify-center rounded-full {roleClass} ring-4 ring-surface-1 shadow-[inset_0_-3px_0_rgba(15,23,42,0.12),0_2px_4px_rgba(15,23,42,0.08)]"
            aria-hidden="true"
        >
            <CharacterAvatar
                role={view.config.role}
                state={view.state}
                title={`${view.config.name}, ${roleLabel}`}
            />
        </div>
    </div>

    <!-- Identity row: name + role + state badge (no more overlap) -->
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
    <p class="px-5 pt-0.5 text-xs text-fg-muted">
        <span class:font-semibold={isHighAttention} class:text-status-failed={isFailed} class:text-status-quarantined={isQuarantined}>
            {statusText}
        </span>
        {#if task}
            <span class="text-fg-subtle"> · </span>
            <span class="text-fg">{task.title}</span>
        {/if}
    </p>

    <!-- Detail block: state-tinted, with state-specific one-liner -->
    <div class="px-5 pt-3 pb-2">
        <p class="text-sm leading-relaxed text-fg">{detail}</p>
        {#if task}
            <div class="mt-2 flex items-center gap-2 text-xs">
                <span class="rounded-md border border-divider bg-canvas px-1.5 py-0.5 font-mono text-fg">
                    task {task.id}
                </span>
                {#if task.requirement}
                    <span class="font-mono text-fg-subtle">{task.requirement}</span>
                {/if}
            </div>
        {/if}
    </div>

    <!-- Meta grid -->
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
