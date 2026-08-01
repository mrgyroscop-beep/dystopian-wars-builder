# Pull-request preview operations

This runbook covers only KAN-39 preview infrastructure. It must not be used to deploy
production routes, custom domains, DNS or application data.

## One-time bootstrap

1. Enable the account Workers subdomain and Worker version preview URLs.
2. Create a `preview` GitHub environment. Restrict deployment branches to the
   protected default branch and require an appropriate reviewer if policy demands it.
3. Add environment secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
   The token must be a separate least-privilege Workers Scripts token for the preview
   account; do not reuse a production or general-purpose token.
4. Keep the repository `Required CI` branch protection enabled. Do not make the
   privileged workflow a pull-request code path.

Never print secret values while confirming bootstrap. A missing environment or
expired token is an external bootstrap failure, not permission to put credentials in
repository variables, artifacts or local `.env` files.

## Normal operation

For a trusted same-repository PR, `Required CI` publishes
`preview-bundle-<40-char SHA>`. `Preview deploy` then publishes:

- stable URL: current verified head of the PR;
- immutable version URL and Worker version ID: exact deployed build;
- `/api/health` evidence containing `environment=preview` and the full commit SHA;
- `preview-evidence-<SHA>` with CI run, URLs, expiry and smoke result.

The deployment is successful only after root, deep link, hashed asset, health, JSON
API 404, security headers and both URLs pass smoke. Existing Required CI Playwright
evidence supplies route/state, accessibility and responsive screenshots for the same
SHA. The controller checks the PR head again after smoke so a superseded run cannot
publish success.

## Cleanup, expiry and recovery

- PR close or merge deletes only `dwb-pr-<PR number>` and is idempotent.
- The daily janitor deletes only allowlisted previews whose newest version is at
  least seven days old.
- The controller refuses a 21st active preview, while updating an existing PR remains
  allowed.
- Failed first deploy: delete that exact allowlisted Worker.
- Failed update: restore and smoke the retained `preview-last-good-pr-<number>` inert
  package. A rollback failure leaves a redacted `ROLLBACK_FAILED` event and requires
  operator attention; it never falls back to a production deployment.

## Safe diagnosis

Use artifact names, PR number, exact commit SHA and the public preview URLs. Do not
paste workflow environment dumps, provider response bodies, authorization/cookie
headers, local paths, Cloudflare account IDs or raw internal error identifiers into
issues. User-visible expiry or access errors should state that the preview is
unavailable and link to the redacted workflow result.

## Bootstrap evidence canary

- 2026-08-01: This documentation-only same-repository change is the auditable canary
  used to validate the trusted live bootstrap workflow described above. Validation
  evidence remains workflow-produced; this note intentionally records no preview
  URL, secret or provider identifier.
