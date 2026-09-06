<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";

    /**
     * Root URL redirects to `/office`. The SvelteKit router is
     * client-side, so the redirect happens in `onMount` after the
     * page has mounted; this avoids any SSR attempt and keeps the
     * shell a pure SPA (per `+layout.ts`).
     */
    onMount(() => {
        void goto("/office", { replaceState: true });
    });
</script>

<p class="p-8 text-fg-muted">Loading office…</p>
