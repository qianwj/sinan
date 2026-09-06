/**
 * Per `web-tech-stack.md` §3.3: the office is a pure SPA. SSR and
 * prerender are both disabled so the build produces a static shell
 * that the sinan-server can serve from `/`.
 */
export const ssr = false;
export const prerender = false;
