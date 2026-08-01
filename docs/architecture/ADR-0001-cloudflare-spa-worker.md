# ADR-0001: React SPA and Worker API on one origin

- Status: accepted
- Jira: KAN-29
- Date: 2026-08-01

## Context

The builder needs client-side routing and a thin edge API without maintaining
separate local servers or cross-origin configuration. Deep links must load the
SPA, while all `/api/*` paths must remain Worker-owned.

## Decision

Use one TypeScript package with React, Vite, React Router, Hono and the official
Cloudflare Vite plugin. `wrangler.jsonc` declares:

- `assets.directory: ./dist/client`;
- `assets.not_found_handling: single-page-application`;
- `assets.run_worker_first: ["/api/*"]`;
- `compatibility_date: 2026-08-01`;
- `nodejs_compat`, following the current Cloudflare recommendation for library
  compatibility; it does not permit Node-only importer code in the Worker;
- observability and source maps, without secrets, bindings or production IDs.

The Worker is invoked only for `/api/*`; unmatched navigations fall back to the
SPA. `npm run dev` and `vite preview` use the Workers runtime via the plugin.

## Consequences

- SPA and API share cookies, origin and local tooling.
- React deep links are independent from API routing.
- Worker integration tests use `@cloudflare/vitest-pool-workers`.
- Deployment configuration, Cloudflare accounts and environments stay in
  KAN-39.

## Sources

- [Cloudflare Vite plugin](https://developers.cloudflare.com/workers/vite-plugin/)
- [React + Vite on Workers](https://developers.cloudflare.com/workers/framework-guides/web-apps/react/)
- [SPA routing and run_worker_first](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/)
- [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
