/**
 * Ambient shape for the module the Astro Cloudflare adapter uses to expose Worker
 * bindings inside request handlers. Astro v6 removed `Astro.locals.runtime.env`;
 * `@astrojs/cloudflare`'s own handler now says to use this instead (see
 * node_modules/@astrojs/cloudflare/dist/utils/cf-helpers.js). No `@cloudflare/workers-types`
 * dependency is added here: callers narrow `env` to the one binding they need (see
 * src/pages/api/history.json.ts).
 */
declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}
