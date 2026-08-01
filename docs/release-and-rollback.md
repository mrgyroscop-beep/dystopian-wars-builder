# Release and rollback

This repository uses immutable `main` commits as release inputs. Until the
application and Cloudflare environments are introduced by their own Jira
issues, a release means a reviewed repository change only; it does not authorise
a production deployment.

## Release checklist

1. Confirm the pull request references its Jira issue and all acceptance
   criteria are evidenced.
2. Confirm the branch is current with `main`, all conversations are resolved,
   `Required CI` passed and an independent reviewer approved the exact SHA.
3. Squash-merge the pull request without bypassing branch protection.
4. Record the resulting `main` SHA in Jira and in any deployment record.
5. When an environment exists, deploy that exact SHA and verify its health
   checks before announcing the release.

## Rollback checklist

1. Identify the last known-good `main` or deployed SHA and preserve diagnostic
   evidence.
2. Open a Jira-linked revert branch from the current `main`.
3. Revert the faulty commit with `git revert`; never reset or force-push
   `main`.
4. Run the full required CI, obtain independent review and merge the revert by
   pull request.
5. When an environment exists, redeploy the selected reviewed SHA and verify
   health checks and user-critical flows.
6. Record the incident, reverted SHA, replacement SHA and any follow-up task.

Database migrations and production data recovery require an issue-specific
backward plan; this generic procedure does not authorise destructive data work.
