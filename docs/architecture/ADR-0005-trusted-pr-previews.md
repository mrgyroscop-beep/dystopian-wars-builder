# ADR-0005: Trusted, immutable pull-request previews

- Status: accepted
- Jira: KAN-39 (preview slice)
- Date: 2026-08-01

## Context

Pull requests need a stable review URL and an immutable URL for the exact commit.
Fork code and pull-request-controlled build scripts must never receive Cloudflare
credentials. A successful build alone is insufficient: the deployed endpoint must
prove its commit and pass smoke checks before the workflow reports success.

## Decision

Use Workers Static Assets and Workers Versions, not Pages. `Required CI` runs with
read-only repository access and no Cloudflare secrets. It builds the exact PR head,
runs the complete suite, and uploads only an inert package:

- pre-bundled `worker/index.js`;
- static `assets/`;
- a manifest bound to repository, PR, base/head SHAs and CI run;
- a deterministic digest of every deployable file.

The privileged `workflow_run` controller is loaded only from the protected default
branch. It never checks out or executes PR source. Before exposing the `preview`
GitHub environment credentials it revalidates same-repository origin, successful CI,
the still-current 40-character head SHA, the artifact name and every checksum. It
generates its own deployment config, prohibits routes and storage/service bindings,
and gives Wrangler only the pre-bundled entrypoint with `--no-bundle`.

Each PR owns exactly `dwb-pr-<number>`. Wrangler first uploads an immutable version
without an alias. That URL must pass smoke checks. The same inert package is then
uploaded with alias `pr-<number>` to provide the stable review URL, followed by a
second smoke and a final current-head check. Rapid pushes cancel stale runs. A
verified last-known-good artifact is retained for seven days and restores the alias
if an update fails; a failed first deployment deletes only its allowlisted Worker.

Close/merge deletes only the exact PR Worker. A daily janitor deletes only names
matching `^dwb-pr-[1-9][0-9]*$` whose latest version is older than seven days. New
Workers are refused at 20 active previews. No preview operation owns production
routes, domains, DNS, storage or releases.

## Security and diagnostics

The environment contains a separately scoped Workers Scripts token and account ID.
Neither value is passed to PR CI, client bundles, manifests or reports. Controllers
emit allowlisted event codes and exact public review evidence, never HTTP bodies,
cookies, authorization headers, filesystem paths, account IDs or raw provider error
payloads. All actions and Wrangler are pinned.

## Consequences

- Preview deployment becomes active only after this controller is present on the
  protected default branch and the `preview` environment is bootstrapped.
- Fork and Dependabot pull requests remain CI-only.
- Production deployment, custom domains and DNS remain the final KAN-39 slice.

## Sources

- [Workers preview URLs](https://developers.cloudflare.com/workers/configuration/previews/)
- [Workers Versions](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/)
- [Static Assets configuration](https://developers.cloudflare.com/workers/static-assets/configuration/)
- [GitHub secure use of workflow_run](https://docs.github.com/en/actions/reference/security/secure-use)
