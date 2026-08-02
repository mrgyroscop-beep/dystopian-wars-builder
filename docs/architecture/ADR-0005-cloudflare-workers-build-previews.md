# ADR-0005: Cloudflare-managed pull-request previews

- Status: accepted; supersedes the custom preview-controller design
- Jira: KAN-39
- Date: 2026-08-02

## Context

Pull requests need a review URL, but a custom deployment controller, artifact
attestation, per-PR Workers, rollback packages and cleanup janitor created more
operational cost than this personal project needs.

## Decision

Connect the repository directly to Cloudflare Workers Builds. `main` uses the normal
Wrangler deploy command. Non-production branches use `wrangler versions upload`, so
Cloudflare creates an immutable version URL and a stable branch alias and posts them
to the pull request.

GitHub Actions remains responsible only for `Required CI`. Cloudflare owns its build
token and repository integration; Cloudflare credentials are not copied into GitHub
workflows. The Worker receives the build commit through
`WORKERS_CI_COMMIT_SHA`, and a small credential-free smoke command verifies the root,
health endpoint and API 404 response.

## Consequences

- Preview infrastructure follows the supported Cloudflare path and has no custom
  privileged controller.
- A branch push creates a new Worker version without promoting it to production.
- `main` pushes deploy through Workers Builds.
- Cloudflare retains and expires preview aliases according to the platform policy;
  this repository does not run a destructive cleanup job.
- Advanced per-PR ownership, rollback and inventory guarantees are intentionally out
  of scope.

## Sources

- [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/)
- [Build configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)
- [Build branches](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
- [Preview URLs](https://developers.cloudflare.com/workers/versions-and-deployments/preview-urls/)
