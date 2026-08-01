import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const PREVIEW_TTL_DAYS = 7;
export const MAX_ACTIVE_PREVIEWS = 20;
export const MAX_ARTIFACT_FILES = 250;
export const MAX_ARTIFACT_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ARTIFACT_TOTAL_BYTES = 25 * 1024 * 1024;
export const MAX_MANIFEST_BYTES = 256 * 1024;
export const WORKER_NAME_PATTERN = /^dwb-pr-([1-9][0-9]*)$/;
export const SHA_PATTERN = /^[0-9a-f]{40}$/;
const PREVIEW_BOOTSTRAP_STAGES = new Set([
  "create-worker",
  "configure-subdomain",
  "cleanup-worker",
]);

const FORBIDDEN_CONFIG_KEYS = [
  "routes",
  "route",
  "d1_databases",
  "kv_namespaces",
  "r2_buckets",
  "services",
  "queues",
  "durable_objects",
  "workflows",
  "hyperdrive",
  "mtls_certificates",
  "dispatch_namespaces",
];

export function assertFullSha(value, field = "sha") {
  if (typeof value !== "string" || !SHA_PATTERN.test(value)) {
    throw new PreviewContractError("INVALID_SHA", `${field} must be a lowercase full commit SHA`);
  }
  return value;
}

export function assertCheckedOutCommit(actual, claimed) {
  const checkedOut = assertFullSha(actual, "checkedOutSha");
  const expected = assertFullSha(claimed, "claimedSha");
  if (checkedOut !== expected) {
    throw new PreviewContractError(
      "CHECKOUT_SHA_MISMATCH",
      "checked out commit does not match the claimed workflow commit",
    );
  }
  return checkedOut;
}

export function assertCleanTrackedCheckout(status) {
  if (typeof status !== "string" || status.trim().length > 0) {
    throw new PreviewContractError(
      "DIRTY_CHECKOUT",
      "tracked checkout changed after the exact commit was selected",
    );
  }
}

export function assertPositiveInteger(value, field) {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== String(value)) {
    throw new PreviewContractError("INVALID_INTEGER", `${field} must be a positive integer`);
  }
  return parsed;
}

export function workerNameForPr(prNumber) {
  return `dwb-pr-${assertPositiveInteger(prNumber, "prNumber")}`;
}

export function previewAliasForPr(prNumber) {
  return `pr-${assertPositiveInteger(prNumber, "prNumber")}`;
}

export function assertAllowlistedWorkerName(name, expectedPrNumber) {
  const match = typeof name === "string" ? WORKER_NAME_PATTERN.exec(name) : null;
  if (!match) {
    throw new PreviewContractError(
      "UNSAFE_WORKER_NAME",
      "worker name is outside the preview allowlist",
    );
  }
  if (expectedPrNumber !== undefined && name !== workerNameForPr(expectedPrNumber)) {
    throw new PreviewContractError("WORKER_NAME_MISMATCH", "worker name does not match the PR");
  }
  return name;
}

export function assertPreviewSafeConfig(configText) {
  for (const key of FORBIDDEN_CONFIG_KEYS) {
    if (new RegExp(`['"]${key}['"]\\s*:`).test(configText)) {
      throw new PreviewContractError(
        "PRODUCTION_CONFIG_FORBIDDEN",
        `preview config contains ${key}`,
      );
    }
  }
  if (!/["']workers_dev["']\s*:\s*true/.test(configText)) {
    throw new PreviewContractError(
      "WORKERS_DEV_REQUIRED",
      "preview config must enable workers.dev",
    );
  }
  if (!/["']preview_urls["']\s*:\s*true/.test(configText)) {
    throw new PreviewContractError("PREVIEW_URLS_REQUIRED", "preview URLs must be enabled");
  }
}

export function assertTrustedWorkflowRun(input) {
  const { event, apiRun, currentPullRequest, expectedRepository } = input;
  const associatedPullRequests = apiRun?.pull_requests;
  const eventRun = event?.workflow_run;
  if (
    event?.action !== "completed" ||
    assertPositiveInteger(eventRun?.id, "event.workflowRunId") !== apiRun?.id ||
    apiRun?.name !== "CI" ||
    apiRun?.event !== "pull_request" ||
    apiRun?.status !== "completed" ||
    apiRun?.conclusion !== "success" ||
    !Array.isArray(associatedPullRequests) ||
    associatedPullRequests.length !== 1
  ) {
    throw new PreviewContractError(
      "UNTRUSTED_WORKFLOW_RUN",
      "workflow run is not a successful PR CI run",
    );
  }

  const associatedPullRequest = associatedPullRequests[0];
  if (
    apiRun.repository?.full_name !== expectedRepository ||
    apiRun.head_repository?.full_name !== expectedRepository ||
    currentPullRequest?.head?.repo?.full_name !== expectedRepository
  ) {
    throw new PreviewContractError(
      "FORK_NOT_DEPLOYABLE",
      "only same-repository pull requests may deploy",
    );
  }

  const prNumber = assertPositiveInteger(associatedPullRequest?.number, "prNumber");
  const headSha = assertFullSha(apiRun.head_sha, "workflowRun.headSha");
  const baseSha = assertFullSha(associatedPullRequest.base?.sha, "pullRequest.baseSha");
  assertCurrentPullRequest(currentPullRequest, {
    repository: expectedRepository,
    prNumber,
    headSha,
    baseSha,
  });
  if (
    apiRun.actor?.login === "dependabot[bot]" ||
    currentPullRequest.user?.login === "dependabot[bot]" ||
    currentPullRequest.head?.ref?.startsWith("dependabot/")
  ) {
    throw new PreviewContractError("DEPENDABOT_CI_ONLY", "Dependabot pull requests are CI-only");
  }

  return {
    runId: assertPositiveInteger(apiRun.id, "workflowRunId"),
    prNumber,
    headSha,
    baseSha,
  };
}

export function assertCurrentPullRequest(pullRequest, expected) {
  if (
    pullRequest?.state !== "open" ||
    pullRequest?.head?.repo?.full_name !== expected.repository ||
    pullRequest?.head?.sha !== expected.headSha ||
    pullRequest?.number !== expected.prNumber ||
    (expected.baseSha !== undefined &&
      (pullRequest?.base?.repo?.full_name !== expected.repository ||
        pullRequest?.base?.sha !== expected.baseSha))
  ) {
    throw new PreviewContractError(
      "STALE_PULL_REQUEST",
      "pull request head changed or is no longer open",
    );
  }
  return pullRequest;
}

export function planAliasRecovery(input) {
  if (!input.mutationStarted) return "none";
  if (!input.existedBefore) return "delete";
  if (input.currentPullRequest?.state !== "open") return "delete";
  const currentMatches =
    input.currentPullRequest.number === input.expected.prNumber &&
    input.currentPullRequest.head?.repo?.full_name === input.expected.repository &&
    input.currentPullRequest.head?.sha === input.expected.headSha;
  if (!currentMatches) return "skip-stale";
  return input.hasPreviousArtifact ? "restore" : "fail-no-lkg";
}

export function createArtifactDigest(files) {
  const canonical = [...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.path}:${file.sha256}:${file.size}`)
    .join("\n");
  return sha256(canonical);
}

export function assertChecksumDocument(content, files) {
  const expected = `${[...files]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `${file.sha256}  ${file.path}`)
    .join("\n")}\n`;
  if (content !== expected) {
    throw new PreviewContractError("CHECKSUM_DOCUMENT_MISMATCH", "checksum document is invalid");
  }
}

export async function collectArtifactFiles(directory) {
  const entries = await inspectArtifactTree(directory);
  const files = [];
  for (const entry of entries) {
    const buffer = await readFile(path.join(directory, entry.path));
    files.push({ path: entry.path, sha256: sha256(buffer), size: entry.size });
  }
  return files;
}

export async function inspectArtifactTree(directory) {
  const entries = [];
  await visit(directory, directory, entries);
  assertArtifactBounds(entries);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function readBoundedText(file, maximumBytes = MAX_MANIFEST_BYTES) {
  const details = await stat(file);
  if (details.size > maximumBytes) {
    throw new PreviewContractError("ARTIFACT_METADATA_SIZE", "artifact metadata is too large");
  }
  return readFile(file, "utf8");
}

async function visit(root, current, entries) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await visit(root, absolute, entries);
    } else if (entry.isFile()) {
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      const details = await stat(absolute);
      entries.push({ path: relative, size: details.size });
    } else {
      throw new PreviewContractError(
        "UNSAFE_ARTIFACT_ENTRY",
        "artifact contains a symbolic link or unsupported entry",
      );
    }
  }
}

export function assertArtifactBounds(entries) {
  if (!Array.isArray(entries) || entries.length === 0 || entries.length > MAX_ARTIFACT_FILES) {
    throw new PreviewContractError("ARTIFACT_FILE_COUNT", "artifact file count is outside limits");
  }
  let totalBytes = 0;
  for (const entry of entries) {
    if (
      typeof entry?.path !== "string" ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 0 ||
      entry.size > MAX_ARTIFACT_FILE_BYTES
    ) {
      throw new PreviewContractError("ARTIFACT_FILE_SIZE", "artifact file size is outside limits");
    }
    totalBytes += entry.size;
  }
  if (totalBytes > MAX_ARTIFACT_TOTAL_BYTES) {
    throw new PreviewContractError("ARTIFACT_TOTAL_SIZE", "artifact total size is outside limits");
  }
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createManifest(input) {
  const prNumber = assertPositiveInteger(input.prNumber, "prNumber");
  const createdAt = new Date(input.createdAt);
  if (Number.isNaN(createdAt.valueOf())) {
    throw new PreviewContractError("INVALID_TIMESTAMP", "createdAt must be an ISO timestamp");
  }
  const expiresAt = new Date(createdAt);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + PREVIEW_TTL_DAYS);

  const files = [...input.files].sort((left, right) => left.path.localeCompare(right.path));
  assertArtifactPaths(files);
  return {
    schemaVersion: 1,
    repository: input.repository,
    headRepository: input.headRepository,
    prNumber,
    workerName: workerNameForPr(prNumber),
    previewAlias: previewAliasForPr(prNumber),
    headSha: assertFullSha(input.headSha, "headSha"),
    baseSha: assertFullSha(input.baseSha, "baseSha"),
    runId: assertPositiveInteger(input.runId, "runId"),
    createdAt: createdAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    appVersion: input.appVersion,
    catalogVersion: input.catalogVersion,
    nodeVersion: input.nodeVersion,
    wranglerVersion: input.wranglerVersion,
    configSha256: input.configSha256,
    lockfileSha256: input.lockfileSha256,
    files,
    artifactSha256: createArtifactDigest(files),
  };
}

export function assertManifest(manifest, expected) {
  if (manifest?.schemaVersion !== 1) {
    throw new PreviewContractError("UNSUPPORTED_MANIFEST", "manifest schema is not supported");
  }
  const exactFields = ["repository", "headRepository", "prNumber", "headSha", "baseSha", "runId"];
  for (const field of exactFields) {
    if (manifest[field] !== expected[field]) {
      throw new PreviewContractError(
        "MANIFEST_MISMATCH",
        `manifest ${field} does not match trusted event`,
      );
    }
  }
  assertAllowlistedWorkerName(manifest.workerName, expected.prNumber);
  if (manifest.previewAlias !== previewAliasForPr(expected.prNumber)) {
    throw new PreviewContractError("ALIAS_MISMATCH", "preview alias does not match the PR");
  }
  assertFullSha(manifest.headSha, "manifest.headSha");
  assertArtifactPaths(manifest.files);
  if (manifest.artifactSha256 !== createArtifactDigest(manifest.files)) {
    throw new PreviewContractError(
      "MANIFEST_DIGEST_MISMATCH",
      "manifest artifact digest is invalid",
    );
  }
  return manifest;
}

export function assertArtifactPaths(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new PreviewContractError("EMPTY_ARTIFACT", "preview artifact is empty");
  }
  const paths = new Set();
  assertArtifactBounds(files);
  for (const file of files) {
    if (
      typeof file?.path !== "string" ||
      path.isAbsolute(file.path) ||
      file.path.includes("..") ||
      (!file.path.startsWith("assets/") && file.path !== "worker/index.js") ||
      !/^[0-9a-f]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0 ||
      paths.has(file.path)
    ) {
      throw new PreviewContractError(
        "UNSAFE_ARTIFACT",
        "artifact contains an unsafe or duplicate file entry",
      );
    }
    paths.add(file.path);
  }
  if (!paths.has("worker/index.js") || !paths.has("assets/index.html")) {
    throw new PreviewContractError(
      "INCOMPLETE_ARTIFACT",
      "artifact is missing Worker or SPA entrypoint",
    );
  }
}

export function selectExpiredPreviewWorkers(workers, now = new Date()) {
  const expired = [];
  for (const worker of workers) {
    if (!WORKER_NAME_PATTERN.test(worker.name)) continue;
    const expiresAt = new Date(worker.expiresAt);
    if (!Number.isNaN(expiresAt.valueOf()) && expiresAt <= now) expired.push(worker.name);
  }
  return expired.sort();
}

export function assertPreviewCapacity(activeWorkerNames, targetName) {
  const active = new Set(activeWorkerNames.filter((name) => WORKER_NAME_PATTERN.test(name)));
  if (!active.has(targetName) && active.size >= MAX_ACTIVE_PREVIEWS) {
    throw new PreviewContractError("PREVIEW_CAPACITY_REACHED", "active preview limit reached");
  }
}

export function redactOperationalError(error) {
  if (error instanceof PreviewBootstrapError) {
    return {
      event: "preview_failure",
      code: error.code,
      stage: error.stage,
    };
  }
  const code = error instanceof PreviewContractError ? error.code : "PREVIEW_OPERATION_FAILED";
  return { event: "preview_failure", code };
}

export class PreviewBootstrapError extends Error {
  constructor(stage) {
    super("Preview bootstrap operation failed");
    if (!PREVIEW_BOOTSTRAP_STAGES.has(stage)) {
      throw new Error("Invalid preview bootstrap stage");
    }
    this.name = "PreviewBootstrapError";
    this.code = "PREVIEW_BOOTSTRAP_FAILED";
    this.stage = stage;
  }
}

export class PreviewContractError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PreviewContractError";
    this.code = code;
  }
}
