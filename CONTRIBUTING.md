# Contributing

All repository changes are linked to Jira and delivered through pull requests.

## Branches

- `main` is the protected, releasable branch. Do not commit to it directly.
- Start from the latest `origin/main`.
- Name working branches `codex/KAN-XX-short-description`, for example
  `codex/KAN-38-git-workflow`.
- Use one Jira issue per branch. Split unrelated work into another issue and
  pull request.

## Commits

Use an imperative subject prefixed with the Jira key:

```text
KAN-38 add required CI workflow
```

Keep commits focused and do not commit generated files, credentials, `.env`
files, reference PDFs or STL models. Do not rewrite shared branch history.

## Pull requests

Every change to `main` must arrive through a pull request. The author must:

1. fill in the Jira key, scope, checks, risks and rollback sections;
2. keep the branch current with `main`;
3. obtain at least one independent approval;
4. resolve all review conversations;
5. pass the stable `Required CI` check.

Use squash merge to keep one traceable change on `main`. The pull request title
and resulting commit must retain the Jira key. Authors do not approve their own
work.

## Continuous integration contract

The application must expose and pass all of these scripts:

- `typecheck`
- `build`
- `lint`
- `format:check`
- `check:architecture`
- `test:unit`
- `test:worker`
- `test:e2e:smoke`

CI installs locked dependencies with `npm ci`, installs the Playwright Chromium
runtime and runs every check. A failing or missing check blocks merge; tests or
protections must not be weakened to make a change pass. Run `wrangler types`
after any binding change and commit the generated `worker-configuration.d.ts`.

## Review, release and rollback

Reviewers compare the pull request with `main`, verify the acceptance criteria
and record any unresolved risk. Release and rollback steps are documented in
[`docs/release-and-rollback.md`](docs/release-and-rollback.md). Production
deployment and production data changes require their own explicitly authorised
task.
