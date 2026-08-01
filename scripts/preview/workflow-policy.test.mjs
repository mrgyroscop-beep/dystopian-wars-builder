import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

const workflows = ["ci.yml", "preview-deploy.yml", "preview-lifecycle.yml"];

async function workflow(name) {
  return readFile(path.resolve(".github/workflows", name), "utf8");
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
  });

  it("deploys only after successful Required CI from a same-repository PR", async () => {
    const content = await workflow("preview-deploy.yml");
    expect(content).toContain("workflow_run.conclusion == 'success'");
    expect(content).toContain("workflow_run.event == 'pull_request'");
    expect(content).toContain(
      "workflow_run.pull_requests[0].head.repo.full_name == github.repository",
    );
    expect(content).toContain("cancel-in-progress: true");
    expect(content).toContain("environment: preview");
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

  it("has exact cleanup and a daily TTL janitor without production selectors", async () => {
    const content = await workflow("preview-lifecycle.yml");
    expect(content).toContain('cron: "17 2 * * *"');
    expect(content).toContain('cleanup.mjs close "${{ github.event.pull_request.number }}"');
    expect(content).toContain("cleanup.mjs janitor");
    expect(content).not.toMatch(/domain|dns|production-worker/i);
  });
});
