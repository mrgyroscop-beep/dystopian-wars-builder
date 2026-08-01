import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  assertCheckedOutCommit,
  assertCleanTrackedCheckout,
  assertFullSha,
  assertPositiveInteger,
  assertPreviewSafeConfig,
  collectArtifactFiles,
  createManifest,
  sha256,
  workerNameForPr,
} from "./core.mjs";

const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
const output = path.resolve(root, options.output ?? "artifacts/preview/package");
const allowedRoot = path.resolve(root, "artifacts/preview");

if (output !== allowedRoot && !output.startsWith(`${allowedRoot}${path.sep}`)) {
  throw new Error("Preview output must stay below artifacts/preview");
}

const repository = required(options, "repository");
const headRepository = required(options, "head-repository");
if (repository !== headRepository)
  throw new Error("Fork PRs are CI-only and cannot create deploy artifacts");

const headSha = assertFullSha(required(options, "head-sha"), "headSha");
assertCheckedOutCommit(
  execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  headSha,
);
assertCleanTrackedCheckout(
  execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
    cwd: root,
    encoding: "utf8",
  }),
);
const baseSha = assertFullSha(required(options, "base-sha"), "baseSha");
const prNumber = assertPositiveInteger(required(options, "pr-number"), "prNumber");
const runId = assertPositiveInteger(required(options, "run-id"), "runId");
const createdAt = required(options, "created-at");
const wranglerConfig = await readFile(path.join(root, "wrangler.jsonc"), "utf8");
assertPreviewSafeConfig(wranglerConfig);

await rm(output, { recursive: true, force: true });
const workerOutput = path.join(output, "worker");
const assetsOutput = path.join(output, "assets");
await mkdir(workerOutput, { recursive: true });

const wrangler = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

execFileSync(
  process.execPath,
  [
    wrangler,
    "versions",
    "upload",
    "--dry-run",
    "--name",
    workerNameForPr(prNumber),
    "--assets",
    "dist/client",
    "--var",
    `APP_VERSION:${required(options, "app-version")}`,
    "--var",
    `CATALOG_VERSION:${required(options, "catalog-version")}`,
    "--var",
    `COMMIT_SHA:${headSha}`,
    "--var",
    "DEPLOYMENT_ENV:preview",
  ],
  { cwd: root, encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] },
);

await cp(
  path.join(root, "dist", "dystopian_wars_builder", "index.js"),
  path.join(workerOutput, "index.js"),
);
await cp(path.join(root, "dist", "client"), assetsOutput, { recursive: true });
const bundlePath = path.join(workerOutput, "index.js");
const bundle = await readFile(bundlePath, "utf8");
if (bundle.includes(root) || bundle.includes("C:\\") || bundle.includes("Authorization")) {
  throw new Error("Bundled Worker contains a local path or credential marker");
}

const files = await collectArtifactFiles(output);
const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const manifest = createManifest({
  repository,
  headRepository,
  prNumber,
  headSha,
  baseSha,
  runId,
  createdAt,
  appVersion: required(options, "app-version"),
  catalogVersion: required(options, "catalog-version"),
  nodeVersion: process.versions.node,
  wranglerVersion: packageJson.devDependencies.wrangler,
  configSha256: sha256(wranglerConfig),
  lockfileSha256: sha256(await readFile(path.join(root, "package-lock.json"))),
  files,
});

await writeFile(
  path.join(output, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(output, "checksums.sha256"),
  `${files.map((file) => `${file.sha256}  ${file.path}`).join("\n")}\n`,
  "utf8",
);
console.log(JSON.stringify({ event: "preview_artifact_ready", prNumber, headSha }));

function parseArguments(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith("--") || value === undefined)
      throw new Error("Arguments must be --name value pairs");
    result[key.slice(2)] = value;
  }
  return result;
}

function required(values, key) {
  const value = values[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing --${key}`);
  return value;
}
