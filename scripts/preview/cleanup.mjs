import process from "node:process";

import {
  PREVIEW_TTL_DAYS,
  assertAllowlistedWorkerName,
  assertPositiveInteger,
  redactOperationalError,
  workerNameForPr,
} from "./core.mjs";
import {
  deletePreviewWorker,
  latestPreviewVersionTimestamp,
  listPreviewWorkers,
} from "./cloudflare-api.mjs";

try {
  const mode = process.argv[2];
  if (mode === "close") {
    const prNumber = assertPositiveInteger(process.argv[3], "prNumber");
    const workerName = workerNameForPr(prNumber);
    await deletePreviewWorker(workerName, prNumber);
    console.log(JSON.stringify({ event: "preview_deleted", prNumber }));
  } else if (mode === "janitor") {
    const threshold = new Date();
    threshold.setUTCDate(threshold.getUTCDate() - PREVIEW_TTL_DAYS);
    let deleted = 0;
    for (const workerName of await listPreviewWorkers()) {
      assertAllowlistedWorkerName(workerName);
      const latest = await latestPreviewVersionTimestamp(workerName);
      if (latest && latest <= threshold) {
        await deletePreviewWorker(workerName);
        deleted += 1;
      }
    }
    console.log(JSON.stringify({ event: "preview_janitor_complete", deleted }));
  } else {
    throw new Error("Cleanup mode must be close or janitor");
  }
} catch (error) {
  console.error(JSON.stringify(redactOperationalError(error)));
  process.exitCode = 1;
}
