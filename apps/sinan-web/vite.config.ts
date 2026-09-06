import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { mockApiPlugin } from "./vite/mockApi.js";

/**
 * Vite config for the office SPA.
 *
 * - `@tailwindcss/vite` is the Tailwind v4 plugin: it scans source files
 *   for utilities and emits the cascade at build time. All tokens live
 *   in `src/app.css` under the `@theme` block.
 * - `mockApiPlugin` is dev-only (`apply: "serve"`) and serves the same
 *   wire shape `sinan-server` will expose at `/api/actors` and
 *   `/api/health`. The web components fetch `/api/actors` and don't
 *   know whether they're talking to the real server or to this mock.
 *   When the real backend lands, swap the baseURL once and the office
 *   runs unchanged.
 * - Port 5173 matches the convention used in `docs/web-tech-stack.md`
 *   §4.1.
 */
export default defineConfig({
    plugins: [mockApiPlugin(), tailwindcss(), sveltekit()],
    server: {
        port: 5173,
        strictPort: true,
    },
});
