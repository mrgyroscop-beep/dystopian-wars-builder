import { describe, expect, it } from "vitest";

import { parseVersionUploadOutput } from "./wrangler-output.mjs";

describe("Wrangler machine output", () => {
  const versionId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const expected = {
    workerName: "dwb-pr-39",
    previewAlias: "pr-39",
    withAlias: true,
  };

  it("extracts matching version, immutable URL and alias from NDJSON", () => {
    const output = [
      JSON.stringify({
        type: "wrangler-session",
        log_file_path: "C:\\private\\wrangler.log",
      }),
      JSON.stringify({
        type: "version-upload",
        version_id: versionId,
        preview_url: "https://aaaaaaaa-dwb-pr-39.example.workers.dev",
        preview_alias_url: "https://pr-39-dwb-pr-39.example.workers.dev",
      }),
      "",
    ].join("\n");
    expect(parseVersionUploadOutput(output, expected)).toEqual({
      versionId,
      previewUrl: "https://aaaaaaaa-dwb-pr-39.example.workers.dev",
      previewAliasUrl: "https://pr-39-dwb-pr-39.example.workers.dev",
    });
  });

  it("rejects dry-run or incomplete output", () => {
    expect(() =>
      parseVersionUploadOutput(
        `${JSON.stringify({ type: "version-upload", version_id: null })}\n`,
        expected,
      ),
    ).toThrow(/version evidence/);
    expect(() =>
      parseVersionUploadOutput(
        `${JSON.stringify({
          type: "version-upload",
          version_id: "a".repeat(32),
          preview_url: "https://aaaaaaaa-dwb-pr-39.example.workers.dev",
        })}\n`,
        { ...expected, withAlias: false },
      ),
    ).toThrow(/version evidence/);
  });

  it("accepts an immutable upload only when no alias was returned", () => {
    const output = `${JSON.stringify({
      type: "version-upload",
      version_id: versionId,
      preview_url: "https://aaaaaaaa-dwb-pr-39.example.workers.dev",
      preview_alias_url: null,
    })}\n`;
    expect(parseVersionUploadOutput(output, { ...expected, withAlias: false })).toEqual({
      versionId,
      previewUrl: "https://aaaaaaaa-dwb-pr-39.example.workers.dev",
      previewAliasUrl: undefined,
    });
  });

  it.each([
    ["non-Workers host", "https://aaaaaaaa-dwb-pr-39.attacker.example"],
    ["wrong version prefix", "https://bbbbbbbb-dwb-pr-39.example.workers.dev"],
    ["wrong worker prefix", "https://aaaaaaaa-production.example.workers.dev"],
  ])("rejects %s", (_name, previewUrl) => {
    const output = `${JSON.stringify({
      type: "version-upload",
      version_id: versionId,
      preview_url: previewUrl,
      preview_alias_url: "https://pr-39-dwb-pr-39.example.workers.dev",
    })}\n`;
    expect(() => parseVersionUploadOutput(output, expected)).toThrow(/invalid preview URL/);
  });

  it("rejects an alias that is not bound to the expected PR worker", () => {
    const output = `${JSON.stringify({
      type: "version-upload",
      version_id: versionId,
      preview_url: "https://aaaaaaaa-dwb-pr-39.example.workers.dev",
      preview_alias_url: "https://pr-40-dwb-pr-39.example.workers.dev",
    })}\n`;
    expect(() => parseVersionUploadOutput(output, expected)).toThrow(/invalid preview URL/);
  });
});
