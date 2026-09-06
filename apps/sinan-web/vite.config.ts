import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import { mockApiPlugin } from "./vite/mockApi.js";

/**
 * Vite config for the office SPA.
 *
 * - `@tailwindcss/vite` is the v4 plugin: it scans source files for
 *   utilities and emits the cascade at build time. The `@theme` block
 *   lives in `src/app.css` and is the only place palette / status
 *   colors are defined.
 * - `mockApiPlugin` (dev-only, scoped via `apply: "serve"`) serves
 *   the same wire shape the real sinan-server exposes at
 *   `/api/actors` and `/api/health`. This is what lets the office
 *   demo run without a separate backend process.
 * - `server.port` matches `web-tech-stack.md` §4.1 (5173).
 */
export default defineConfig({
    plugins: [mockApiPlugin(), tailwindcss(), sveltekit()],
    server: {
        port: 5173,
        strictPort: true,
    },
});
