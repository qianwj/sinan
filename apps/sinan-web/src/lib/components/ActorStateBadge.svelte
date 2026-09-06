<script lang="ts">
    import type { ActorState } from "sinan-core";

    /**
     * Color-coded pill showing an actor's current state. The mapping
     * mirrors the status tokens in `app.css` and the §6 state language
     * in `web-visual-language.md`. The badge label carries the
     * discriminator verbatim; richer states (paused, failed,
     * quarantined) get a short reason underneath.
     */
    let { state }: { state: ActorState } = $props();

    const kindClass = $derived(swatchClass(state.kind));
    const reason = $derived(stateReason(state));

    function swatchClass(kind: ActorState["kind"]): string {
        switch (kind) {
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
                return "bg-status-terminated";
            case "created":
            case "initializing":
                return "bg-status-running";
        }
    }

    function stateReason(s: ActorState): string {
        switch (s.kind) {
            case "paused":
                return s.reason;
            case "failed":
                return s.error.message;
            case "quarantined":
                return s.reason;
            case "running":
                return `task ${s.taskId}`;
            case "restarting":
                return s.fromCheckpoint === null ? "from scratch" : `from ${s.fromCheckpoint}`;
            case "terminated":
                return s.clean ? "clean" : "unclean";
            case "ready":
            case "created":
            case "initializing":
                return "";
        }
    }
</script>

<span
    class="inline-flex items-baseline gap-2 rounded-full px-3 py-1 text-sm font-medium text-white {kindClass}"
>
    <span class="font-mono uppercase tracking-wide text-xs">{state.kind}</span>
    {#if reason}
        <span class="text-white/85 text-xs font-normal">{reason}</span>
    {/if}
</span>
