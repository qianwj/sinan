<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";

    /**
     * Root URL redirects to the office. The SvelteKit router is
     * client-side; this runs in `onMount` to avoid SSR (the office is a
     * pure SPA per `+layout.ts`).
     */
    onMount(() => {
        void goto("/office", { replaceState: true });
    });
</script>

<p class="p-8 text-fg-muted">Loading office…</p>
