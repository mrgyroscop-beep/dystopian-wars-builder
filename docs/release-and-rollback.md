# Release and rollback

The project has one branch and one release path:

1. commit to `main`;
2. push `main`;
3. GitHub Actions runs `npm ci`, build and `wrangler deploy`;
4. one HTTP smoke checks that production returns `200 OK`.

There are no release branches, pull-request gates, preview environments,
promotion controllers or automated evidence artifacts.

Tests remain available for manual use when a risky area changes. They do not run
for every release.

For rollback, select the previous deployment in Cloudflare or run:

```powershell
npx wrangler rollback --yes
```
