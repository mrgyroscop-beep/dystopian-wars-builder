import { execFileSync } from "node:child_process";

import { assertCheckedOutCommit, redactOperationalError } from "./core.mjs";

try {
  const actual = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const claimed = process.argv[2];
  assertCheckedOutCommit(actual, claimed);
  console.log(JSON.stringify({ event: "exact_checkout_verified", commitSha: actual }));
} catch (error) {
  console.error(JSON.stringify(redactOperationalError(error)));
  process.exitCode = 1;
}
