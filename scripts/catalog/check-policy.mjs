import { execFileSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const publication = JSON.parse(
  await readFile(path.resolve(process.cwd(), "scripts/catalog/publication.json"), "utf8"),
);
const generatedCatalogAuthorized =
  publication.authorization === "confirmed-by-project-owner" &&
  publication.publishGeneratedCatalog === true;
const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split(/\r?\n/u)
  .filter(Boolean);
const forbiddenData = candidates.filter(
  (file) =>
    /\.(?:cat|gst)$/iu.test(file) ||
    (file.startsWith("data/generated/") &&
      !file.endsWith("README.md") &&
      !generatedCatalogAuthorized),
);
if (forbiddenData.length > 0) {
  throw new Error(
    `Upstream XML/generated catalog data must not be committed without a confirmed license: ${forbiddenData.join(", ")}`,
  );
}

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/u,
  /\bATATT3xFfGF0[A-Za-z0-9_-]{20,}\b/u,
];
for (const file of candidates) {
  if (!/\.(?:cjs|js|json|jsx|md|mjs|ts|tsx|ya?ml)$/iu.test(file)) continue;
  const contents = await readFile(file, "utf8");
  if (secretPatterns.some((pattern) => pattern.test(contents))) {
    throw new Error(`Credential-like content must not be committed: ${file}`);
  }
}

for (const root of ["src", "worker"]) {
  for (const file of await walk(root)) {
    if (!/\.(?:js|ts|tsx|mjs)$/u.test(file)) continue;
    const contents = await readFile(file, "utf8");
    if (/scripts[\\/]catalog|from\s+["']saxes["']/u.test(contents)) {
      throw new Error(`Node-only catalog importer crossed the runtime bundle boundary: ${file}`);
    }
  }
}
process.stdout.write("Catalog source and bundle policy validated.\n");

async function walk(relative) {
  const entries = await readdir(path.resolve(process.cwd(), relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else files.push(child);
  }
  return files;
}
