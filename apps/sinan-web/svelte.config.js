import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * SvelteKit config for the office SPA.
 *
 * `adapter-static` produces a fully static `build/` that `sinan-server`
 * can serve at `/`. `fallback: 'index.html'` makes the SPA shell handle
 * client-side routes so the server doesn't need a router for the web
 * bundle. `strict: true` fails the build on missing link targets so we
 * catch dead references at build time, not runtime.
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
