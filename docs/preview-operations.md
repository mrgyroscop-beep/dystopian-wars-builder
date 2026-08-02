# Pull-request preview operations

KAN-39 uses one Cloudflare Worker and one small preview job in the existing CI
workflow. There is no separate deployment controller, custom Worker per pull request,
artifact attestation, rollback package or cleanup service.

Native Workers Builds previews are unavailable on this Cloudflare account, so the
preview job calls the supported `wrangler versions upload` command directly.

## One-time settings

- Worker: `dystopian-wars-builder`;
- `workers_dev` and `preview_urls`: enabled in `wrangler.jsonc`;
- GitHub environment: `preview`;
- environment secrets: `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`;
- token scope: Worker script upload for the target account.

Only same-repository pull requests run the preview job. Fork pull requests run
`Required CI` without Cloudflare credentials.

## Normal operation

After `Required CI` succeeds, the `Preview` job:

1. checks out the exact pull-request commit;
2. installs locked dependencies and builds the application;
3. runs `wrangler versions upload --preview-alias pr-N` against the single Worker;
4. verifies `/`, `/api/health` and an unknown `/api/*` route.

The stable URL is
`https://pr-N-dystopian-wars-builder.mrgyroscop.workers.dev`. The health response
must report the exact pull-request SHA. The uploaded version is not promoted to the
active production deployment.

Run the same smoke manually when needed:

```powershell
npm run preview:smoke -- https://pr-N-dystopian-wars-builder.mrgyroscop.workers.dev <40-character-sha>
```

## Failure and retention

- Push a fix or rerun the job after a transient failure.
- A failed preview does not replace the active Worker deployment.
- Cloudflare retains at most the 1000 most recent aliases; this repository does not
  run a destructive janitor.
- Production deployment, custom domains, DNS and application data remain out of
  scope for KAN-39.
