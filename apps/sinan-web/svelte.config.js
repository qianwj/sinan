import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * SvelteKit configuration for the office SPA.
 *
 * - `adapter-static` produces a fully static `build/` directory. The
 *   `fallback: 'index.html'` line makes the SPA shell handle client-side
 *   routes — the production server (sinan-server) does not need a router
 *   for the web bundle.
 * - `vitePreprocess()` lets `.svelte` files import TypeScript and
 *   Tailwind utility classes without a separate Babel pass.
 */
export default {
    preprocess: vitePreprocess(),
    kit: {
        adapter: adapter({
            pages: "build",
            assets: "build",
            fallback: "index.html",
            precompress: false,
            strict: true,
        }),
    },
};
