/**
 * Per `docs/web-tech-stack.md` §3.3: the office is a pure SPA. SSR
 * and prerender are both disabled so the build produces a static
 * shell that `sinan-server` can serve at `/`.
 */
export const ssr = false;
export const prerender = false;
