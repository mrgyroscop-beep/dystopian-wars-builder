import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  assertChecksumDocument,
  assertCurrentPullRequest,
  assertManifest,
  assertPreviewCapacity,
  collectArtifactFiles,
  createArtifactDigest,
  inspectArtifactTree,
  planAliasRecovery,
  readBoundedText,
  redactOperationalError,
} from "./core.mjs";
import { deletePreviewWorker, listPreviewWorkers } from "./cloudflare-api.mjs";
import { parseVersionUploadOutput } from "./wrangler-output.mjs";

const artifact = path.resolve(process.argv[2] ?? "artifacts/preview/current/package");
const trustedEvent = JSON.parse(
  await readFile(process.argv[3] ?? "artifacts/preview/trusted-event.json", "utf8"),
);
const previousArtifact = process.argv[4] ? path.resolve(process.argv[4]) : undefined;
let manifest;
let existedBefore = false;
let anyUploadMutationStarted = false;
let stableAliasMutationStarted = false;
let previousManifest;

try {
  manifest = await verifiedManifest(artifact, trustedEvent);
  await assertPullRequestIsCurrent(trustedEvent);
  const activeWorkers = await listPreviewWorkers();
  existedBefore = activeWorkers.includes(manifest.workerName);
  assertPreviewCapacity(activeWorkers, manifest.workerName);
  if (existedBefore) {
    if (!previousArtifact)
      throw new Error("Existing preview cannot update without last-known-good");
    await inspectArtifactTree(previousArtifact);
    previousManifest = await verifiedManifest(
      previousArtifact,
      JSON.parse(await readBoundedText(path.join(previousArtifact, "manifest.json"))),
    );
    if (
      previousManifest.repository !== manifest.repository ||
      previousManifest.prNumber !== manifest.prNumber
    ) {
      throw new Error("Previous artifact belongs to a different preview");
    }
  }

  anyUploadMutationStarted = true;
  const immutable = await uploadVersion(manifest, artifact, false);
  await smoke(immutable.previewUrl, manifest.headSha);
  await assertPullRequestIsCurrent(trustedEvent);

  stableAliasMutationStarted = true;
  const stable = await uploadVersion(manifest, artifact, true);
  if (!stable.previewAliasUrl || stable.previewAliasUrl === stable.previewUrl) {
    throw new Error("Wrangler did not return distinct stable and immutable preview URLs");
  }
  await smoke(stable.previewAliasUrl, manifest.headSha);
  await assertPullRequestIsCurrent(trustedEvent);

  const report = {
    schemaVersion: 1,
    status: "success",
    repository: manifest.repository,
    prNumber: manifest.prNumber,
    commitSha: manifest.headSha,
    requiredCiRunId: manifest.runId,
    workerName: manifest.workerName,
    versionId: immutable.versionId,
    immutableUrl: immutable.previewUrl,
    aliasVersionId: stable.versionId,
    aliasImmutableUrl: stable.previewUrl,
    stableUrl: stable.previewAliasUrl,
    smokePassed: true,
    productionUntouched: true,
    expiresAt: manifest.expiresAt,
  };
  const reportPath = path.resolve("artifacts/preview/deployment-report.json");
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(
    JSON.stringify({
      event: "preview_deployed",
      prNumber: manifest.prNumber,
      commitSha: manifest.headSha,
    }),
  );
} catch (error) {
  try {
    if (manifest) {
      const currentPullRequest = await getCurrentPullRequest(trustedEvent);
      const recovery = planAliasRecovery({
        mutationStarted: existedBefore ? stableAliasMutationStarted : anyUploadMutationStarted,
        existedBefore,
        hasPreviousArtifact: Boolean(previousManifest && previousArtifact),
        currentPullRequest,
        expected: trustedEvent,
      });
      if (recovery === "restore") {
        const restored = await uploadVersion(previousManifest, previousArtifact, true);
        await smoke(restored.previewAliasUrl, previousManifest.headSha);
        const afterRestore = await getCurrentPullRequest(trustedEvent);
        if (afterRestore.state !== "open") {
          await deletePreviewWorker(manifest.workerName, manifest.prNumber);
        }
      } else if (recovery === "delete") {
        await deletePreviewWorker(manifest.workerName, manifest.prNumber);
      } else if (recovery === "fail-no-lkg") {
        throw new Error("Alias mutation cannot be recovered without last-known-good");
      } else if (recovery === "skip-stale") {
        console.error(
          JSON.stringify({ event: "preview_rollback_skipped", code: "SUPERSEDED_HEAD" }),
        );
      }
    }
  } catch {
    console.error(JSON.stringify({ event: "preview_rollback_failed", code: "ROLLBACK_FAILED" }));
  }
  console.error(JSON.stringify(redactOperationalError(error)));
  process.exitCode = 1;
}

async function verifiedManifest(directory, expected) {
  await inspectArtifactTree(directory);
  const value = JSON.parse(await readBoundedText(path.join(directory, "manifest.json")));
  assertManifest(value, expected);
  const actualFiles = (await collectArtifactFiles(directory)).filter(
    (file) => file.path !== "manifest.json" && file.path !== "checksums.sha256",
  );
  if (
    actualFiles.length !== value.files.length ||
    createArtifactDigest(actualFiles) !== value.artifactSha256
  ) {
    throw new Error("Artifact integrity verification failed");
  }
  assertChecksumDocument(
    await readBoundedText(path.join(directory, "checksums.sha256")),
    value.files,
  );
  return value;
}

async function uploadVersion(value, directory, withAlias) {
  const outputFile = path.join(
    requiredEnvironment("RUNNER_TEMP"),
    `wrangler-output-${crypto.randomUUID()}.json`,
  );
  const configFile = path.join(
    requiredEnvironment("RUNNER_TEMP"),
    `wrangler-preview-${crypto.randomUUID()}.json`,
  );
  const config = {
    name: value.workerName,
    main: path.join(directory, "worker", "index.js"),
    compatibility_date: "2026-08-01",
    compatibility_flags: ["nodejs_compat"],
    workers_dev: true,
    preview_urls: true,
    assets: {
      directory: path.join(directory, "assets"),
      not_found_handling: "single-page-application",
      run_worker_first: ["/api/*"],
    },
    vars: {
      APP_VERSION: value.appVersion,
      CATALOG_VERSION: value.catalogVersion,
      COMMIT_SHA: value.headSha,
      DEPLOYMENT_ENV: "preview",
    },
  };
  await writeFile(configFile, `${JSON.stringify(config)}\n`, { encoding: "utf8", mode: 0o600 });
  const arguments_ = [
    "versions",
    "upload",
    "--config",
    configFile,
    "--no-bundle",
    "--strict",
    "--tag",
    value.headSha,
    "--message",
    `preview pr-${value.prNumber} expires ${value.expiresAt}`,
  ];
  if (withAlias) arguments_.push("--preview-alias", value.previewAlias);

  const wrangler = path.resolve("node_modules", "wrangler", "bin", "wrangler.js");
  execFileSync(process.execPath, [wrangler, ...arguments_], {
    cwd: process.cwd(),
    env: { ...process.env, WRANGLER_OUTPUT_FILE_PATH: outputFile },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseVersionUploadOutput(await readFile(outputFile, "utf8"), {
    workerName: value.workerName,
    previewAlias: value.previewAlias,
    withAlias,
  });
}

async function smoke(url, sha) {
  if (!url) throw new Error("Preview URL is missing");
  execFileSync(process.execPath, [path.resolve("scripts/preview/smoke.mjs"), url, sha], {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function assertPullRequestIsCurrent(expected) {
  assertCurrentPullRequest(await getCurrentPullRequest(expected), expected);
}

async function getCurrentPullRequest(expected) {
  const response = await fetch(
    `https://api.github.com/repos/${expected.repository}/pulls/${expected.prNumber}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${requiredEnvironment("GITHUB_TOKEN")}`,
        "User-Agent": "dystopian-wars-preview",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (!response.ok) throw new Error(`GitHub request failed with status ${response.status}`);
  return response.json();
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
