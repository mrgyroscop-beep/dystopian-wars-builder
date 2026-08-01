#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildDataset } from "./lib/build-dataset.mjs";
import { fetchLockedSources, verifyCachedSources } from "./lib/fetch-sources.mjs";
import { CatalogImportError } from "./lib/errors.mjs";
import {
  beginCatalogCheck,
  createOperationalDiagnostic,
  promoteDataset,
  readCurrent,
  recordOperationalFailure,
  rollbackDataset,
  verifyRelease,
} from "./lib/promotion.mjs";
import { readSourceLock } from "./lib/source-lock.mjs";
import { readCachedProvenance, verifyAndCacheLockedProvenance } from "./lib/verify-provenance.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const command = process.argv[2] ?? "help";
const options = parseOptions(process.argv.slice(3));
const lockPath = path.resolve(
  options.lock ?? path.join(repositoryRoot, "scripts/catalog/source-lock.json"),
);
const cacheRoot = path.resolve(options.cache ?? path.join(repositoryRoot, ".cache/catalog"));
const runtimeRoot = path.resolve(
  options.runtime ?? path.join(repositoryRoot, "data/generated/runtime"),
);
let importCommitted = false;
let requestedReleaseId = null;
let importOperationId = null;

try {
  if (command === "help") printHelp();
  else if (command === "fetch") {
    const lock = await readSourceLock(lockPath);
    const provenance = await verifyAndCacheLockedProvenance(lock, cacheRoot);
    print({ command, provenance, sources: await fetchLockedSources(lock, cacheRoot) });
  } else if (command === "build") {
    const lock = await readSourceLock(lockPath);
    const sources = await verifyCachedSources(lock, cacheRoot);
    const provenance = await readCachedProvenance(lock, cacheRoot);
    const dataset = await buildDataset(lock, sources, provenance);
    requestedReleaseId = dataset.releaseId;
    print({ command, releaseId: dataset.releaseId, manifest: dataset.manifest });
  } else if (command === "import") {
    const lock = await readSourceLock(lockPath);
    const expectedCurrent = options.expected
      ? options.expected === "none"
        ? null
        : options.expected
      : undefined;
    const check = await beginCatalogCheck(runtimeRoot, {
      ...(options.expected ? { expectedCurrent } : {}),
    });
    importOperationId = check.operationId;
    const provenance = await verifyAndCacheLockedProvenance(lock, cacheRoot);
    const sources = await fetchLockedSources(lock, cacheRoot);
    const dataset = await buildDataset(lock, sources, provenance);
    requestedReleaseId = dataset.releaseId;
    const result = await promoteDataset(dataset, runtimeRoot, {
      operationId: importOperationId,
      ...(options.expected ? { expectedCurrent } : {}),
    });
    importCommitted = true;
    print({ command, ...result, manifest: dataset.manifest });
  } else if (command === "verify") {
    const current = await readCurrent(runtimeRoot);
    if (!current)
      throw new CatalogImportError("CURRENT_MISSING", "No current catalog release exists", {});
    await verifyRelease(path.join(runtimeRoot, "releases", current.releaseId), current.releaseId);
    print({ command, releaseId: current.releaseId, valid: true });
  } else if (command === "rollback") {
    if (!options.release)
      throw new CatalogImportError("CLI_ARGUMENT", "rollback requires --release=<sha256>", {});
    print({
      command,
      ...(await rollbackDataset(runtimeRoot, options.release, {
        expectedCurrent: options.expected,
      })),
    });
  } else {
    throw new CatalogImportError("CLI_COMMAND", "Unknown catalog command", { command });
  }
} catch (error) {
  if (command === "import" && !importCommitted) {
    try {
      await recordOperationalFailure(runtimeRoot, error, {
        action: "PROMOTE",
        operationId: importOperationId,
        requestedReleaseId,
      });
    } catch {
      // The primary error remains authoritative; diagnostics never mutate lifecycle.json.
    }
  }
  const activeReleaseId = await readCurrent(runtimeRoot)
    .then((current) => current?.releaseId ?? null)
    .catch(() => null);
  process.stderr.write(`${JSON.stringify(createOperationalDiagnostic(error, activeReleaseId))}\n`);
  process.exitCode = 1;
}

function parseOptions(arguments_) {
  const result = {};
  for (const argument of arguments_) {
    const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
    if (!match)
      throw new CatalogImportError("CLI_ARGUMENT", "Options must use --name=value syntax", {
        argument,
      });
    result[match[1]] = match[2];
  }
  return result;
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function printHelp() {
  process.stdout.write(
    "catalog commands: fetch | build | import | verify | rollback --release=<sha256>\n" +
      "options: --lock=<file> --cache=<directory> --runtime=<directory> --expected=<sha256|none>\n",
  );
}
