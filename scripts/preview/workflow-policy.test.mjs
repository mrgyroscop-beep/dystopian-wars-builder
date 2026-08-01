import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflows = ["ci.yml", "preview-deploy.yml", "preview-lifecycle.yml"];

async function workflow(name) {
  return readFile(path.resolve(".github/workflows", name), "utf8");
}

function namedStep(content, name) {
  const marker = `      - name: ${name}`;
  const start = content.indexOf(marker);
  if (start < 0) throw new Error(`Missing workflow step: ${name}`);
  const end = content.indexOf("\n      - name:", start + marker.length);
  return content.slice(start, end < 0 ? undefined : end);
}

function transportedPaths(paths, includeHiddenFiles) {
  return paths.filter(
    (file) => includeHiddenFiles || !file.split("/").some((part) => part.startsWith(".")),
  );
}

function assertNarrowHiddenUpload(step) {
  if (!/^\s+include-hidden-files:\s+true\s*$/m.test(step)) return;
  if (!step.startsWith("      - name: Upload inert preview deployment artifact")) {
    throw new Error("Hidden files may only be enabled for the inert preview package");
  }
  const artifactPath = /^\s+path:\s+(.+)\s*$/m.exec(step)?.[1];
  if (artifactPath !== "artifacts/preview/package/") {
    throw new Error("Hidden preview upload path must be exact and package-scoped");
  }
}

describe("preview workflow policy", () => {
  it("pins every action to a full commit SHA", async () => {
    for (const name of workflows) {
      const content = await workflow(name);
      const uses = [...content.matchAll(/^\s*uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
      expect(uses.length).toBeGreaterThan(0);
      for (const reference of uses) {
        expect(reference, `${name}: ${reference}`).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/);
      }
    }
  });

  it("keeps Cloudflare credentials out of PR CI", async () => {
    const content = await workflow("ci.yml");
    expect(content).not.toMatch(/CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/);
    expect(content).toContain("github.event.pull_request.head.repo.full_name == github.repository");
    expect(content).toContain("github.actor != 'dependabot[bot]'");
    expect(content).toContain("!startsWith(github.head_ref, 'dependabot/')");
  });

  it("checks out and asserts the exact PR head or push commit, never a synthetic merge ref", async () => {
    const content = await workflow("ci.yml");
    const exactExpression = "${{ github.event.pull_request.head.sha || github.sha }}";
    expect(content).toContain(`ref: ${exactExpression}`);
    expect(content).toContain(`assert-checkout.mjs\n          "${exactExpression}"`);
    expect(content).not.toMatch(/refs\/pull|github\.ref/);
  });

  it("round-trips every manifest file, including Wrangler's hidden assets allowlist", () => {
    const manifestFiles = [
      "assets/.assetsignore",
      "assets/index.css",
      "assets/index.html",
      "assets/index.js",
      "worker/index.js",
      "wrangler.json",
    ];

    const defaultUpload = transportedPaths(manifestFiles, false);
    expect(defaultUpload).toHaveLength(5);
    expect(defaultUpload).not.toEqual(manifestFiles);

    const hiddenAwareUpload = transportedPaths(manifestFiles, true);
    expect(hiddenAwareUpload).toHaveLength(6);
    expect(hiddenAwareUpload).toEqual(manifestFiles);
  });

  it("enables hidden transport only for the exact inert package path", async () => {
    const content = await workflow("ci.yml");
    const inertUpload = namedStep(content, "Upload inert preview deployment artifact");
    const reviewEvidence = namedStep(content, "Upload reproducible review evidence");

    expect(inertUpload).toContain("path: artifacts/preview/package/");
    expect(inertUpload).toContain("include-hidden-files: true");
    expect(reviewEvidence).not.toContain("include-hidden-files: true");

    const uploadSteps = content
      .split(/(?=^ {6}- name:)/gm)
      .filter((step) => step.includes("actions/upload-artifact@"));
    const hiddenUploads = uploadSteps.filter((step) => step.includes("include-hidden-files: true"));
    expect(hiddenUploads).toHaveLength(1);
    expect(hiddenUploads[0]).toContain("name: Upload inert preview deployment artifact");
    for (const step of uploadSteps) expect(() => assertNarrowHiddenUpload(step)).not.toThrow();
  });

  it.each([
    [
      "broad artifacts root",
      "      - name: Upload inert preview deployment artifact\n        with:\n          path: artifacts/\n          include-hidden-files: true\n",
    ],
    [
      "repository glob",
      "      - name: Upload inert preview deployment artifact\n        with:\n          path: '**'\n          include-hidden-files: true\n",
    ],
    [
      "review evidence",
      "      - name: Upload reproducible review evidence\n        with:\n          path: artifacts/\n          include-hidden-files: true\n",
    ],
  ])("rejects unsafe hidden upload scope: %s", (_name, step) => {
    expect(() => assertNarrowHiddenUpload(step)).toThrow();
  });

  it("keeps the privileged job gate payload-safe and resolves detailed trust through GitHub API", async () => {
    const content = await workflow("preview-deploy.yml");
    expect(content).toContain("workflow_run.conclusion == 'success'");
    expect(content).toContain("workflow_run.event == 'pull_request'");
    expect(content).toContain("workflow_run.name == 'CI'");
    expect(content).not.toContain("workflow_run.pull_requests[0].head.repo.full_name");
    expect(content).toContain("cancel-in-progress: true");
    expect(content).toContain("environment: preview");
    const resolver = await readFile(
      path.resolve("scripts/preview/resolve-trusted-run-core.mjs"),
      "utf8",
    );
    expect(resolver).toContain("/actions/runs/${runId}");
    expect(resolver).not.toContain("/actions/runs/${runId}/pull_requests");
    expect(resolver).toContain("apiRun?.pull_requests");
    expect(resolver).toContain("/pulls/${prNumber}");
  });

  it("checks out only the protected default branch in privileged workflows", async () => {
    for (const name of ["preview-deploy.yml", "preview-lifecycle.yml"]) {
      const content = await workflow(name);
      expect(content).toContain("ref: ${{ github.event.repository.default_branch }}");
      expect(content).toContain("persist-credentials: false");
      expect(content).not.toMatch(/ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha/);
      expect(content).not.toMatch(/pull_request\.head\.ref/);
    }
  });

  it("verifies inert files before exposing Cloudflare credentials", async () => {
    const content = await workflow("preview-deploy.yml");
    const verify = content.indexOf("Verify exact artifact before credentials are exposed");
    const token = content.indexOf("CLOUDFLARE_API_TOKEN");
    expect(verify).toBeGreaterThan(0);
    expect(token).toBeGreaterThan(verify);
    const controller = await readFile(path.resolve("scripts/preview/deploy.mjs"), "utf8");
    expect(controller).toContain('"--no-bundle"');
    expect(content).not.toMatch(/npm run (?:build|ci).*CLOUDFLARE/s);
  });

  it("runs deployed route, state, accessibility and responsive browser smoke on both URLs", async () => {
    const workflowContent = await workflow("preview-deploy.yml");
    expect(workflowContent).toContain("Install trusted browser for deployed preview smoke");
    const smoke = await readFile(path.resolve("scripts/preview/smoke.mjs"), "utf8");
    expect(smoke).toContain('new URL("/rosters/scaffold-demo", baseUrl)');
    expect(smoke).toContain('["loading", "empty", "error", "success"]');
    expect(smoke).toContain("{ width: 1280, height: 800 }");
    expect(smoke).toContain("{ width: 360, height: 800 }");
    expect(smoke).toContain('globalThis.document.querySelectorAll("h1")');
  });

  it("reports immutable version evidence from the same upload and guards alias mutations", async () => {
    const controller = await readFile(path.resolve("scripts/preview/deploy.mjs"), "utf8");
    expect(controller).toContain("versionId: immutable.versionId");
    expect(controller).toContain("immutableUrl: immutable.previewUrl");
    expect(controller.indexOf("stableAliasMutationStarted = true")).toBeLessThan(
      controller.indexOf("uploadVersion(manifest, artifact, true)"),
    );
    expect(controller).toContain("planAliasRecovery");
    expect(controller).toContain("await getCurrentPullRequest(trustedEvent)");
  });

  it("bootstraps only before a first version and verifies resource cleanup on failure", async () => {
    const controller = await readFile(path.resolve("scripts/preview/deploy.mjs"), "utf8");
    const provider = await readFile(path.resolve("scripts/preview/cloudflare-api.mjs"), "utf8");
    expect(controller.indexOf("ensurePreviewWorkerForUpload")).toBeLessThan(
      controller.indexOf("uploadVersion(manifest, artifact, false)"),
    );
    expect(controller).toContain("if (bootstrapCreated)");
    expect(controller).toContain("deleteBootstrappedPreviewWorker");
    expect(provider).toContain('request("/workers/workers")');
    expect(provider).toContain('request("/workers/scripts")');
    expect(provider).not.toMatch(/wrangler\s+deploy/);
  });

  it("bounds artifact metadata before privileged reads", async () => {
    for (const name of ["verify-artifact.mjs", "deploy.mjs"]) {
      const controller = await readFile(path.resolve("scripts/preview", name), "utf8");
      expect(controller.indexOf("inspectArtifactTree")).toBeLessThan(
        controller.indexOf("readBoundedText(path.join"),
      );
    }
  });

  it("has exact cleanup and a daily TTL janitor without production selectors", async () => {
    const content = await workflow("preview-lifecycle.yml");
    expect(content).toContain('cron: "17 2 * * *"');
    expect(content).toContain('cleanup.mjs close "${{ github.event.pull_request.number }}"');
    expect(content).toContain("cleanup.mjs janitor");
    expect(content).not.toMatch(/domain|dns|production-worker/i);
  });
});
