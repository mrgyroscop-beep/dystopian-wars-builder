# Repository settings

This file records the server-side controls for the public GitHub repository.
It contains no credentials.

## Applied repository settings

- visibility: public;
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
- CODEOWNER review is not additionally required;
- the branch is current before merge;
- `Required CI` is successful;
- review conversations are resolved;
- linear history is required;
- administrators cannot bypass the rule;
- force-push and branch deletion are forbidden.

This policy intentionally needs a second GitHub account to approve a change.
The repository owner cannot approve their own last push.

## Public repository safeguards

The repository was made public so GitHub Free can enforce the `main` protection
policy without a paid plan. Before publication, all reachable commit author and
committer addresses were rewritten to the account's GitHub-provided `noreply`
address. GitHub email privacy remains enabled so server-generated pull-request
merge refs also use a `noreply` address.

Because every tracked object is publicly readable, do not commit credentials,
private reference material, PDF or STL files, upstream XML exports, or generated
catalog datasets that are not approved for redistribution. Verify the branch
protection through the GitHub API after any repository visibility or plan
change.
