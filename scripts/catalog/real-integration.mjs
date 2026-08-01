import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { buildDataset } from "./lib/build-dataset.mjs";
import { canonicalJson } from "./lib/canonical.mjs";
import { fetchLockedSources } from "./lib/fetch-sources.mjs";
import { promoteDataset, readCurrent, verifyRelease } from "./lib/promotion.mjs";
import { readSourceLock } from "./lib/source-lock.mjs";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const temporary = await mkdtemp(path.join(os.tmpdir(), "dwb-catalog-real-"));

try {
  const lock = await readSourceLock(path.join(import.meta.dirname, "source-lock.json"));
  const sources = await fetchLockedSources(lock, path.join(temporary, "cache"));
  const first = await buildDataset(lock, sources);
  const second = await buildDataset(lock, sources);
  if (
    first.releaseId !== second.releaseId ||
    [...first.files].some(([name, bytes]) => second.files.get(name) !== bytes)
  ) {
    throw new Error("Real-source build is not byte reproducible");
  }
  const expectedNames = [
    "Alliance",
    "Commonwealth",
    "Crown",
    "Dystopian Wars 4.0",
    "Empire",
    "Enlightened",
    "Imperium",
    "Rules Glossary",
    "Sultanate",
    "Union",
  ];
  const actualNames = first.manifest.inventory.map((entry) => entry.name).sort();
  if (JSON.stringify(actualNames) !== JSON.stringify(expectedNames.sort())) {
    throw new Error(`Real-source inventory mismatch: ${actualNames.join(", ")}`);
  }
  const runtime = path.join(temporary, "runtime");
  await promoteDataset(first, runtime, {
    expectedCurrent: null,
    attemptedAt: "2000-01-01T00:00:00.000Z",
  });
  const current = await readCurrent(runtime);
  if (current?.releaseId !== first.releaseId)
    throw new Error("Atomic promotion did not publish the real-source release");
  await verifyRelease(path.join(runtime, "releases", first.releaseId), first.releaseId);

  const evidence = {
    schemaVersion: 1,
    reviewSha: process.env.REVIEW_SHA ?? "local",
    sourceCommit: lock.commit,
    sourceTree: lock.tree,
    releaseId: first.releaseId,
    reproducible: true,
    promotedAndVerified: true,
    files: sources.map(({ path: sourcePath, sha256, bytes }) => ({
      path: sourcePath,
      sha256,
      bytes,
    })),
    inventory: first.manifest.inventory,
  };
  const evidenceDirectory = path.join(repositoryRoot, "artifacts");
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    path.join(evidenceDirectory, "catalog-import-evidence.json"),
    canonicalJson(evidence),
  );
  process.stdout.write(
    `${JSON.stringify({ releaseId: first.releaseId, documents: actualNames.length, reproducible: true })}\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
