# Dystopian Wars Builder

Public application repository and production-oriented scaffold for a Dystopian
Wars 4.0 fleet builder. It runs a React single-page application and a Hono
Cloudflare Worker API on the same local origin through the Cloudflare Vite
plugin.

The application shell is accompanied by a Node-only, deterministic catalogue
importer. Game-domain adapters, functional rosters, authentication, D1 and
production deployment belong to later Jira tasks.

Reference PDF and STL files may remain beside the checkout for research. They
are ignored by Git and must never be committed or uploaded to the repository.
The same restriction applies to upstream XML exports and generated catalog
datasets unless their redistribution has been explicitly approved.

## Requirements

- Node.js 24 or newer;
- npm and the committed `package-lock.json`;
- Chromium installed by Playwright for E2E (`npm run test:e2e:install`).

## Local development

```powershell
npm ci
npm run types:generate
npm run dev
```

One Vite command starts both the React SPA and the Worker runtime. Open the URL
printed by Vite (normally `http://localhost:5173`). Useful endpoints:

- `/` — local roster-library placeholder and state fixtures;
- `/?state=loading|empty|error|success` — deterministic UI fixtures;
- `/rosters/new` — validated local roster creation flow;
- `/rosters/scaffold-demo` — responsive builder shell;
- `/settings` — live same-origin health status;
- `/api/health` — Worker JSON health endpoint.

Static asset fallback serves `index.html` for deep SPA links, while
`/api/*` is routed to the Worker first.

## Development workflow

1. Update `main`.
2. Run only checks relevant to the change.
3. Review the diff and commit with the Jira key in the subject.
4. Push `main`; GitHub Actions builds and deploys production.
5. One HTTP smoke confirms the site returns `200 OK`.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete
conventions and [docs/repository-settings.md](docs/repository-settings.md) for
the applied GitHub settings and public-repository safeguards.

## Continuous integration

The deployment workflow intentionally runs no test suite. It builds, deploys and
makes one HTTP request to production. Run specialist checks only when their area
changes, for example:

```powershell
npm run test:unit
npm run test:worker
npm run test:e2e:smoke
```

`test:catalog:real` uses immutable, hash-verified upstream files and writes only
hash/count evidence under `artifacts/`; it does not commit or publish source or
generated game data. See [catalog operations](docs/catalog-operations.md) for
the update, promotion and rollback contract.

`typecheck` first verifies that `worker-configuration.d.ts` still matches
`wrangler.jsonc`; regenerate it with `npm run types:generate` after any binding
change. Failed E2E runs retain a trace and screenshot in GitHub Actions.

Pushing `main` runs one `wrangler deploy` and one production `200 OK` smoke.
Rollback selects the previous Worker deployment. See [preview
operations](docs/preview-operations.md) and
[ADR-0005](docs/architecture/ADR-0005-simple-cloudflare-previews.md).

## Architecture

The allowed dependency direction is UI → application → domain. Infrastructure
implements application ports; the browser and Worker are composition roots.
Node-only catalogue tooling remains outside both bundles.

- `src/app` — bootstrap, router and shell;
- `src/routes` — route components and error boundaries;
- `src/ui` — reusable UI primitives;
- `src/domain` — pure TypeScript rules and types;
- `src/application` — use cases, ports and runtime-boundary schemas;
- `src/infrastructure` — adapters;
- `worker` — Hono Worker entrypoint and API tests;
- `scripts/catalog` — Node-only import, validation and promotion tooling;
- `data/fixtures`, `data/generated` — controlled data inputs/outputs;
- `docs/architecture` — architecture decisions;
- `e2e` — same-origin browser and API smoke tests.

See [ADR-0001](docs/architecture/ADR-0001-cloudflare-spa-worker.md),
[ADR-0002](docs/architecture/ADR-0002-layered-boundaries.md),
[ADR-0003](docs/architecture/ADR-0003-catalog-import-seam.md) and
[ADR-0004](docs/architecture/ADR-0004-catalog-ingestion-and-promotion.md), and
[ADR-0005](docs/architecture/ADR-0005-simple-cloudflare-previews.md).

## Release and rollback

Releases are traceable to the pushed `main` SHA. Recovery selects the previous
Cloudflare deployment. The operational checklist is in
[docs/release-and-rollback.md](docs/release-and-rollback.md).
