<script lang="ts">
    import type { ActorState, ActorStateKind } from "sinan-core";

    /**
     * Color-coded pill showing an actor's current state. Color is the
     * *primary* signal here (per `web-agent-office.md` §6.1 the
     * semantic color = blocking semantics), but it is paired with the
     * state kind written out in monospace and a short reason
     * underneath when the state carries one — color is never the only
     * signal (`NFR-02`, `REQ-ATT-02`).
     */
    let { state }: { state: ActorState } = $props();

    const swatchClass = $derived(swatchFor(state.kind));
    const reason = $derived(reasonFor(state));

    function swatchFor(kind: ActorStateKind): string {
        switch (kind) {
            case "ready":        return "bg-status-ready";
            case "running":      return "bg-status-running";
            case "paused":       return "bg-status-paused";
            case "failed":       return "bg-status-failed";
            case "restarting":   return "bg-status-restarting";
            case "quarantined":  return "bg-status-quarantined";
            case "terminated":   return "bg-status-terminated";
            // `created` and `initializing` are not persisted to the
            // wire shape (per `actor-runtime.md` §3.2), but if they
            // ever show up via dev fixtures we still need a color.
            case "created":
            case "initializing":
                return "bg-status-running";
        }
    }

    function reasonFor(s: ActorState): string {
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
                return s.fromCheckpoint === null
                    ? "from scratch"
                    : `from ${s.fromCheckpoint}`;
            case "terminated":
                return s.clean ? "clean shutdown" : "unclean shutdown";
            case "ready":
            case "created":
            case "initializing":
                return "";
        }
    }
</script>

<span
    class="inline-flex items-baseline gap-2 rounded-full px-3 py-1 text-sm font-medium text-white {swatchClass}"
    data-state={state.kind}
>
    <span class="font-mono text-xs uppercase tracking-wide">{state.kind}</span>
    {#if reason}
        <span class="text-xs font-normal text-white/85">{reason}</span>
    {/if}
</span>
