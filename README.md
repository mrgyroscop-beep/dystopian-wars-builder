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

1. Start from an up-to-date `main` branch.
2. Create a Jira-linked branch named `codex/KAN-XX-short-description`.
3. Commit changes with the Jira key in every commit subject.
4. Open a pull request and complete the repository template.
5. Review the final diff and wait for `Required CI` before merging.

Direct work on `main`, force-pushes and merge commits are not part of the
supported process. See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete
conventions and [docs/repository-settings.md](docs/repository-settings.md) for
the applied GitHub settings and public-repository safeguards.

## Continuous integration

The `Required CI` job has a stable name so it can be required by branch
protection. Run the same checks locally:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm run check:architecture
npm run test:catalog:policy
npm run test:unit
npm run test:catalog
npm run test:catalog:real
npm run test:worker
npm run build
npm run test:catalog:bundle
npm run test:e2e:smoke
```

`test:catalog:real` uses immutable, hash-verified upstream files and writes only
hash/count evidence under `artifacts/`; it does not commit or publish source or
generated game data. See [catalog operations](docs/catalog-operations.md) for
the update, promotion and rollback contract.

`typecheck` first verifies that `worker-configuration.d.ts` still matches
`wrangler.jsonc`; regenerate it with `npm run types:generate` after any binding
change. E2E creates ignored screenshots and JSON metadata under `artifacts/`.
Each review-evidence sidecar records the route, fixture state, viewport and exact
review commit SHA; CI publishes the directory as a workflow artifact.

After `Required CI`, one small same-repository preview job uploads a native
Cloudflare Worker version with the stable `pr-N` alias and verifies it. There is no
custom deployment controller, per-PR Worker, artifact transport, rollback package or
cleanup service. Verify a deployed URL manually with
`npm run preview:smoke -- <url> <commit-sha>`. See [preview
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

Releases must be traceable to an immutable commit on `main`; recovery uses a
reviewed revert rather than rewriting history. The operational checklist is in
[docs/release-and-rollback.md](docs/release-and-rollback.md).
