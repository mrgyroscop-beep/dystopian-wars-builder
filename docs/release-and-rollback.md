# Release and rollback

The project has one branch and one release path:

1. commit to `main`;
2. push `main`;
3. for a schema change, apply its D1 migration as a controlled step before push;
4. GitHub Actions runs `npm ci`, build and `wrangler deploy`;
5. one HTTP smoke checks that production returns `200 OK`.

There are no release branches, pull-request gates, preview environments,
promotion controllers or automated evidence artifacts.

Tests remain available for manual use when a risky area changes. They do not run
for every release.

For rollback, select the previous deployment in Cloudflare or run:

```powershell
npx wrangler rollback --yes
```

D1 migrations are forward-only. If a schema change needs to be undone, add a
new corrective migration before rolling the Worker back.
