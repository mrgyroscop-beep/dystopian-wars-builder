import { describe, expect, it } from "vitest";

import { parseVersionUploadOutput } from "./wrangler-output.mjs";

describe("Wrangler machine output", () => {
  it("ignores session diagnostics and extracts version evidence from NDJSON", () => {
    const output = [
      JSON.stringify({
        type: "wrangler-session",
        log_file_path: "C:\\private\\wrangler.log",
      }),
      JSON.stringify({
        type: "version-upload",
        version_id: "version-id",
        preview_url: "https://immutable.example.workers.dev",
        preview_alias_url: "https://stable.example.workers.dev",
      }),
      "",
    ].join("\n");
    expect(parseVersionUploadOutput(output)).toEqual({
      versionId: "version-id",
      previewUrl: "https://immutable.example.workers.dev",
      previewAliasUrl: "https://stable.example.workers.dev",
    });
  });

  it("rejects dry-run or incomplete output", () => {
    expect(() =>
      parseVersionUploadOutput(`${JSON.stringify({ type: "version-upload", version_id: null })}\n`),
    ).toThrow(/version evidence/);
  });
});
