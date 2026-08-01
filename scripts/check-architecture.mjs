import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const requiredDirectories = [
  "src/app",
  "src/routes",
  "src/ui",
  "src/domain",
  "src/application",
  "src/infrastructure",
  "worker",
  "scripts/catalog",
  "data/fixtures",
  "data/generated",
  "docs/architecture",
  "e2e",
];

const sourceExtensions = new Set([".ts", ".tsx", ".js", ".mjs"]);
const errors = [];

async function collectFiles(relativeDirectory) {
  const entries = await readdir(path.join(repositoryRoot, relativeDirectory), {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(relativePath)));
    } else {
      files.push(relativePath);
    }
  }

  return files;
}

for (const directory of requiredDirectories) {
  try {
    await readdir(path.join(repositoryRoot, directory));
  } catch {
    errors.push(`Required architecture directory is missing: ${directory}`);
  }
}

const domainFiles = (await collectFiles("src/domain")).filter((file) =>
  sourceExtensions.has(path.extname(file)),
);
const domainForbiddenImports =
  /(?:from\s*["'][^"']*(?:react|hono|cloudflare:|node:|scripts\/catalog|src\/application|\.\.\/application)|import\s*\(\s*["'][^"']*(?:react|hono|cloudflare:|node:|scripts\/catalog|src\/application|\.\.\/application))/;

for (const file of domainFiles) {
  const content = await readFile(path.join(repositoryRoot, file), "utf8");
  if (domainForbiddenImports.test(content)) {
    errors.push(`Domain boundary imports a forbidden runtime dependency: ${file}`);
  }
}

const bundleFiles = [...(await collectFiles("src")), ...(await collectFiles("worker"))].filter(
  (file) => sourceExtensions.has(path.extname(file)),
);

for (const file of bundleFiles) {
  const content = await readFile(path.join(repositoryRoot, file), "utf8");
  if (content.includes("scripts/catalog")) {
    errors.push(`Browser/Worker source imports the Node-only catalogue seam: ${file}`);
  }
}

const viewFiles = [...(await collectFiles("src/routes")), ...(await collectFiles("src/ui"))].filter(
  (file) => sourceExtensions.has(path.extname(file)),
);
const infrastructureImport =
  /(?:from\s*["'][^"']*infrastructure(?:\/|["'])|import\s*\(\s*["'][^"']*infrastructure(?:\/|["']))/;

for (const file of viewFiles) {
  const content = await readFile(path.join(repositoryRoot, file), "utf8");
  if (infrastructureImport.test(content)) {
    errors.push(`Route/UI boundary imports infrastructure directly: ${file}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) {
    console.error(error);
  }
  process.exitCode = 1;
} else {
  console.log("Architecture boundaries validated.");
}
