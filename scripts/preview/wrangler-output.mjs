const VERSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseVersionUploadOutput(content, expected) {
  const records = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const record = records.find((item) => item.type === "version-upload");
  if (
    record?.type !== "version-upload" ||
    typeof record.version_id !== "string" ||
    typeof record.preview_url !== "string" ||
    !VERSION_ID.test(record.version_id)
  ) {
    throw new Error("Wrangler output did not contain preview version evidence");
  }
  const previewUrl = assertPreviewUrl(record.preview_url, {
    prefix: `${record.version_id.slice(0, 8)}-${expected.workerName}.`,
  });
  const previewAliasUrl =
    record.preview_alias_url === undefined || record.preview_alias_url === null
      ? undefined
      : assertPreviewUrl(record.preview_alias_url, {
          prefix: `${expected.previewAlias}-${expected.workerName}.`,
        });
  if (expected.withAlias && !previewAliasUrl) {
    throw new Error("Wrangler output did not contain the required stable preview alias");
  }
  if (!expected.withAlias && previewAliasUrl) {
    throw new Error("Immutable upload unexpectedly mutated a preview alias");
  }
  return {
    versionId: record.version_id,
    previewUrl,
    previewAliasUrl,
  };
}

function assertPreviewUrl(value, expected) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.hostname.endsWith(".workers.dev") ||
    !url.hostname.startsWith(expected.prefix)
  ) {
    throw new Error("Wrangler output contained an invalid preview URL");
  }
  return url.toString().replace(/\/$/, "");
}
