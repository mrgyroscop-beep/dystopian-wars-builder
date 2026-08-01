# Repository settings

This file records the expected server-side controls for the private GitHub
repository. It contains no credentials.

## Applied repository settings

- visibility: private;
- default branch: `main`;
- allowed merge method: squash only;
- merge commits and rebase merges: disabled;
- head-branch deletion after merge: enabled;
- pull-request branches may be updated from the base branch.

## Required `main` protection

The target protection policy is:

- all changes arrive through a pull request;
- at least one approval, with stale approvals dismissed and the last push
  approved by someone other than its author;
- the branch is current before merge;
- `Required CI` is successful;
- review conversations are resolved;
- linear history is required;
- administrators cannot bypass the rule;
- force-push and branch deletion are forbidden.

## Verified plan limitation

During `KAN-38`, both the branch-protection and repository-ruleset APIs returned
HTTP 403 for this private repository with the message that GitHub Pro is
required or the repository must be public. The repository remains private by
design. Consequently, the desired `main` policy is documented and the CI check
exists, but GitHub does not currently enforce the policy server-side.

Do not make the repository public or weaken the target policy as a workaround.
After GitHub Pro (or another private-repository plan with rules support) is
available, apply the policy above and verify through the API that `main` reports
`protected: true` before treating protection as complete.
