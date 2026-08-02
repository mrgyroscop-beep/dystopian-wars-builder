# Pull-request preview operations

KAN-39 uses Cloudflare Workers Builds directly. GitHub Actions runs only
`Required CI`; there is no credentialed preview workflow, custom Worker per pull
request, rollback package or cleanup controller in this repository.

## Cloudflare project settings

Connect `mrgyroscop-beep/dystopian-wars-builder` to the
`dystopian-wars-builder` Worker and configure:

- production branch: `main`;
- build command: `npm run build`;
- production deploy command:
  `npx wrangler deploy --var COMMIT_SHA:$WORKERS_CI_COMMIT_SHA --var DEPLOYMENT_ENV:production`;
- builds for non-production branches: enabled;
- non-production deploy command:
  `npx wrangler versions upload --var COMMIT_SHA:$WORKERS_CI_COMMIT_SHA --var DEPLOYMENT_ENV:preview`.

`wrangler.jsonc` explicitly enables `workers_dev` and `preview_urls`. Workers
Builds supplies `WORKERS_CI_COMMIT_SHA` and creates the branch alias and immutable
version URL. Cloudflare posts both URLs to the pull request.

## Verification

After both `Required CI` and the Workers Build succeed, verify either preview URL:

```powershell
npm run preview:smoke -- https://preview.example.workers.dev <40-character-sha>
```

The smoke command retries for propagation, then checks `/`, `/api/health` and an
unknown `/api/*` route. The health response must report the exact commit SHA.

## Failure and cleanup

- A failed Workers Build does not replace the active `main` deployment.
- Rerun or push a fix; do not add Cloudflare credentials to GitHub Actions.
- Cloudflare owns preview versions and branch aliases. No repository janitor deletes
  Workers or account resources.
- Roll back production with a reviewed Git revert and a new successful `main` build.

Provider configuration and build logs are available under the Worker's **Settings >
Build** and **Deployments** pages.
