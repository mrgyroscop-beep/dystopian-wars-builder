# ADR-0005: Simple Cloudflare pull-request previews

- Status: superseded by KAN-58 direct-main production flow
- Jira: KAN-39
- Date: 2026-08-02

## Context

Pull requests need a review URL, but a custom deployment controller, artifact
attestation, per-PR Workers, rollback packages and cleanup janitor created more
operational cost than this personal project needs. Cloudflare Workers Builds branch
previews were considered first, but this account does not have access to that feature.

## Decision

Keep preview deployment in one short job after `Required CI`. For same-repository
pull requests it builds the exact head commit and calls
`wrangler versions upload --preview-alias pr-N` against the single
`dystopian-wars-builder` Worker. A small credential-free smoke command verifies the
root, health endpoint and API 404 response. The health binding contains the exact
pull-request SHA.

GitHub stores the Cloudflare credentials in the `preview` environment. Fork pull
requests never run the preview job. The uploaded version is not promoted to the
active deployment.

## Consequences

- The repository has one workflow and one Worker instead of a privileged controller
  and a fleet of per-PR Workers.
- A PR update replaces only the stable `pr-N` preview alias.
- Cloudflare retains old versions and up to 1000 recent aliases; the repository does
  not run a destructive cleanup job.
- Advanced artifact attestation, rollback, ownership and inventory guarantees are
  intentionally out of scope.

## Sources

- [Wrangler versions upload](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
