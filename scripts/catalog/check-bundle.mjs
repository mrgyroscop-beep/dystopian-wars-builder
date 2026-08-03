import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const markers = ["SaxesParser"];
for (const file of await walk("dist")) {
  if (!/\.(?:js|css|html|json)$/u.test(file)) continue;
  const contents = await readFile(file, "utf8");
  const marker = markers.find((candidate) => contents.includes(candidate));
  if (marker) throw new Error(`Node-only importer marker ${marker} leaked into ${file}`);
}
process.stdout.write("Browser/Worker bundle contains no catalog importer.\n");

async function walk(relative) {
  const entries = await readdir(relative, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(child)));
    else files.push(child);
  }
  return files;
}
