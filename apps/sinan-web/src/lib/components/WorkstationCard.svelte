<script lang="ts">
    import type { ActorRole, ActorView, ActorState } from "sinan-core";
    import ActorStateBadge from "./ActorStateBadge.svelte";
    import { lookupTask } from "$lib/fixtures.js";

    /**
     * One workstation = one actor. Card layout per
     * `web-agent-office.md` §5.1:
     *   - identity strip (left border) → role color (`§5.3`)
     *   - state badge + (for `running`) task title + (for
     *     `paused` / `failed` / `quarantined`) the human reason
     *   - last event timestamp (relative)
     *
     * The card does not log raw agent output (`§3.2`).
     */
    let { view }: { view: ActorView } = $props();

    const initials = $derived(initialsFor(view.config.name));
    const roleLabel = $derived(roleLabelFor(view.config.role));
    const identityClass = $derived(identityClassFor(view.config.role));
    const statusClass = $derived(statusClassFor(view.state));
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

    function identityClassFor(role: ActorRole): string {
        switch (role) {
            case "product_manager":
                return "border-l-role-pm";
            case "designer":
                return "border-l-role-designer";
            case "development_engineer":
                return "border-l-role-developer";
            case "qa_engineer":
                return "border-l-role-qa";
            case "devops_engineer":
                return "border-l-role-devops";
        }
    }

    /**
     * Status class raises the border contrast for states that demand
     * attention (`§5.3` "需介入显著标识"). The non-attention states
     * share the default border so the room reads calm.
     */
    function statusClassFor(state: ActorState): string {
        switch (state.kind) {
            case "failed":
            case "quarantined":
                return "border-status-failed";
            case "paused":
            case "failed":
                return "border-status-paused";
            case "terminated":
                return "border-divider opacity-60";
            default:
                return "border-divider";
        }
    }

    /**
     * The "detail" line is the short explanation under the state
     * badge: task title for `running`, the reason for `paused` /
     * `failed` / `quarantined`, the checkpoint note for
     * `restarting`, and a quiet "idle" for `ready` / `created`.
     */
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

    /** Optional task id + requirement when the actor is running. */
    function taskFor(state: ActorState): { id: string; requirement: string | null } | null {
        if (state.kind !== "running") return null;
        const summary = lookupTask(state.taskId);
        return {
            id: state.taskId,
            requirement: summary?.requirement ?? null,
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
    class="flex flex-col gap-3 rounded-lg border border-l-4 {identityClass} {statusClass} bg-surface-1 p-4 shadow-sm transition hover:shadow-md focus-within:ring-2 focus-within:ring-status-running"
>
    <header class="flex items-start gap-3">
        <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-canvas-deep text-sm font-semibold text-palette-slate-50"
            aria-hidden="true"
        >
            {initials}
        </div>
        <div class="min-w-0 flex-1">
            <p class="truncate text-base font-semibold text-fg">{view.config.name}</p>
            <p class="truncate text-xs uppercase tracking-wider text-fg-subtle">{roleLabel}</p>
        </div>
        <ActorStateBadge state={view.state} />
    </header>

    <p class="text-sm text-fg-muted">{detail}</p>

    {#if task}
        <p class="font-mono text-xs text-fg-subtle">
            <span class="text-fg-subtle">task</span>
            <span class="ml-1 font-mono text-fg-muted">{task.id}</span>
            {#if task.requirement}
                <span class="ml-1 text-fg-subtle">·</span>
                <span class="ml-1 font-mono text-fg-subtle">{task.requirement}</span>
            {/if}
        </p>
    {/if}

    <dl class="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs text-fg-muted">
        <dt class="font-mono uppercase tracking-wide text-fg-subtle">id</dt>
        <dd class="truncate font-mono">{view.id}</dd>
        <dt class="font-mono uppercase tracking-wide text-fg-subtle">workspace</dt>
        <dd class="truncate font-mono">{view.config.workspace}</dd>
        <dt class="font-mono uppercase tracking-wide text-fg-subtle">policy</dt>
        <dd class="truncate font-mono">{view.config.policy.kind}</dd>
        <dt class="font-mono uppercase tracking-wide text-fg-subtle">last event</dt>
        <dd class="truncate font-mono">{relativeLastEvent}</dd>
    </dl>
</article>
