<script lang="ts">
    import type { ActorView } from "sinan-core";
    import ActorStateBadge from "./ActorStateBadge.svelte";

    /**
     * One workstation = one actor. The card carries the §5.3 office
     * vocabulary: a role tag, a name, the current state pill, the
     * workspace path, and a relative "last event" timestamp. Click
     * selection is reserved for the next slice; the demo just renders.
     */
    let { view }: { view: ActorView } = $props();

    const initials = $derived(initialsFor(view.config.name));
    const relativeLastEvent = $derived(
        view.lastEventAt === null ? "never" : relativeTime(view.lastEventAt),
    );
    const roleLabel = $derived(roleLabelFor(view.config.role));

    function initialsFor(name: string): string {
        const parts = name.trim().split(/\s+/);
        if (parts.length === 0) return "?";
        const first = parts[0]?.charAt(0) ?? "";
        const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
        return (first + last).toUpperCase() || "?";
    }

    function roleLabelFor(role: ActorView["config"]["role"]): string {
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
            default: {
                const _unreachable: never = role;
                return _unreachable;
            }
        }
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
    class="flex flex-col gap-3 rounded-xl border border-divider bg-surface-1 p-5 shadow-sm transition hover:shadow-md focus-within:ring-2 focus-within:ring-status-running"
>
    <header class="flex items-start gap-3">
        <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-canvas-deep text-sm font-semibold text-fg"
            aria-hidden="true"
        >
            {initials}
        </div>
        <div class="min-w-0 flex-1">
            <p class="truncate text-base font-semibold text-fg">{view.config.name}</p>
            <p class="truncate text-xs uppercase tracking-wider text-fg-subtle">{roleLabel}</p>
        </div>
    </header>

    <ActorStateBadge state={view.state} />

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
