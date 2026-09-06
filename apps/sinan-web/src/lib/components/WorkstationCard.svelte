<script lang="ts">
    import type { ActorRole, ActorView, ActorState } from "sinan-core";
    import ActorStateBadge from "./ActorStateBadge.svelte";
    import { lookupTask } from "$lib/fixtures.js";

    /**
     * One workstation = one actor (web-agent-office.md §5.1).
     *
     * Layout (top → bottom):
     *   - top stripe in the status color (4px) — identity color
     *     shows on the left; status color shows on top, so a single
     *     glance tells you "who they are" and "what they are doing"
     *   - identity block: large initials, name, role label
     *   - state badge + detail line
     *   - task line when running (taskId + requirement + title)
     *   - meta grid: id, workspace, policy, last event
     */
    let { view }: { view: ActorView } = $props();

    const initials = $derived(initialsFor(view.config.name));
    const roleLabel = $derived(roleLabelFor(view.config.role));
    const roleClass = $derived(roleClassFor(view.config.role));
    const statusClass = $derived(statusClassFor(view.state));
    const statusTint = $derived(statusTintFor(view.state));
    const detail = $derived(detailFor(view));
    const task = $derived(taskFor(view.state));
    const relativeLastEvent = $derived(
        view.lastEventAt === null ? "never" : relativeTime(view.lastEventAt),
    );

    function initialsFor(name: string): string {
        const parts = name.trim().split(/\s+/);
        if (parts.length === 0) return "?";
        const first = parts[0]?.charAt(0) ?? "";
        const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
        return (first + last).toUpperCase() || "?";
    }

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
                return "idle";
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
    class="group relative flex flex-col overflow-hidden rounded-xl border border-divider bg-surface-1 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_1px_3px_rgba(15,23,42,0.06)] transition hover:-translate-y-px hover:shadow-[0_4px_12px_rgba(15,23,42,0.08),0_2px_4px_rgba(15,23,42,0.06)] focus-within:ring-2 focus-within:ring-status-running focus-within:ring-offset-2"
    data-state={view.state.kind}
>
    <div class="h-1 w-full {statusClass}" aria-hidden="true"></div>

    <div class="flex items-start gap-3 px-5 pt-4">
        <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-sm font-semibold text-palette-slate-50 {roleClass}"
            aria-hidden="true"
        >
            {initials}
        </div>
        <div class="min-w-0 flex-1">
            <p class="truncate text-base font-semibold leading-tight text-fg">
                {view.config.name}
            </p>
            <p class="mt-0.5 truncate text-xs font-medium uppercase tracking-wider text-fg-muted">
                {roleLabel}
            </p>
        </div>
        <ActorStateBadge state={view.state} />
    </div>

    <div class="px-5 pt-3 pb-2 {statusTint}">
        <p class="text-sm leading-relaxed text-fg">{detail}</p>
        {#if task}
            <div class="mt-2 space-y-1 text-xs">
                <p class="font-mono text-fg-muted">
                    <span class="text-fg-subtle">task</span>
                    <span class="ml-1 text-fg">{task.id}</span>
                </p>
                {#if task.requirement}
                    <p class="font-mono text-fg-subtle">{task.requirement}</p>
                {/if}
            </div>
        {/if}
    </div>

    <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-divider px-5 py-3 text-xs text-fg-muted">
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
