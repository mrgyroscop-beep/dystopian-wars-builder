# Contributing

This is a small project with one production branch: `main`.

## Normal workflow

1. Make a focused Jira-linked change on `main`.
2. Run only the checks relevant to that change.
3. Review the diff and commit with the Jira key in the subject.
4. Push `main`; GitHub Actions builds, deploys and checks production once.

Do not force-push or delete `main`. Do not commit credentials, `.env` files,
reference PDFs/STLs, upstream XML exports or unapproved generated catalog data.

The full unit, catalog, Worker and Playwright suites remain available for risky
changes, but they are intentionally not part of every release.

Production rollback uses the previous Cloudflare Worker deployment. Data
migrations require their own rollback plan.
