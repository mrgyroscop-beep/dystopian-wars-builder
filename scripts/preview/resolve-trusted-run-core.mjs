import { assertFullSha, assertPositiveInteger, assertTrustedWorkflowRun } from "./core.mjs";

export async function resolveTrustedWorkflowRun({ event, repository, request }) {
  const runId = assertPositiveInteger(event?.workflow_run?.id, "event.workflowRunId");
  const apiRun = await request(`/repos/${repository}/actions/runs/${runId}`);
  const associatedPullRequests = apiRun?.pull_requests;
  if (!Array.isArray(associatedPullRequests) || associatedPullRequests.length !== 1) {
    throw new Error("Workflow run must resolve to exactly one pull request");
  }

  const associatedPullRequest = associatedPullRequests[0];
  const prNumber = assertPositiveInteger(associatedPullRequest?.number, "prNumber");
  assertFullSha(associatedPullRequest?.base?.sha, "pullRequest.baseSha");
  const currentPullRequest = await request(`/repos/${repository}/pulls/${prNumber}`);

  return assertTrustedWorkflowRun({
    event,
    apiRun,
    currentPullRequest,
    expectedRepository: repository,
  });
}
