<script lang="ts">
    import "../app.css";
    let { children } = $props();
</script>

<div class="min-h-screen bg-canvas text-fg antialiased">
    {@render children()}
</div>
