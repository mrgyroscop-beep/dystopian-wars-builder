import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  assertChecksumDocument,
  assertManifest,
  collectArtifactFiles,
  createArtifactDigest,
} from "./core.mjs";

const artifact = path.resolve(process.argv[2] ?? "artifacts/preview/package");
const expected = JSON.parse(
  await readFile(process.argv[3] ?? "artifacts/preview/trusted-event.json", "utf8"),
);
const manifest = JSON.parse(await readFile(path.join(artifact, "manifest.json"), "utf8"));
assertManifest(manifest, expected);

const actualFiles = (await collectArtifactFiles(artifact)).filter(
  (file) => file.path !== "manifest.json" && file.path !== "checksums.sha256",
);
if (
  actualFiles.length !== manifest.files.length ||
  createArtifactDigest(actualFiles) !== manifest.artifactSha256
) {
  throw new Error("Artifact contents do not match the verified manifest");
}
assertChecksumDocument(
  await readFile(path.join(artifact, "checksums.sha256"), "utf8"),
  manifest.files,
);

console.log(
  JSON.stringify({
    event: "preview_artifact_verified",
    prNumber: manifest.prNumber,
    headSha: manifest.headSha,
  }),
);
