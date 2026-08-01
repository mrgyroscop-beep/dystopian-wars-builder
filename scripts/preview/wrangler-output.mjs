export function parseVersionUploadOutput(content) {
  const records = content
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const record = records.find((item) => item.type === "version-upload");
  if (
    record?.type !== "version-upload" ||
    typeof record.version_id !== "string" ||
    typeof record.preview_url !== "string"
  ) {
    throw new Error("Wrangler output did not contain preview version evidence");
  }
  return {
    versionId: record.version_id,
    previewUrl: record.preview_url,
    previewAliasUrl: record.preview_alias_url,
  };
}
