export class CatalogImportError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "CatalogImportError";
    this.code = code;
    this.details = redact(details);
  }
}

const secretKey = /authorization|cookie|credential|password|secret|token/i;

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        secretKey.test(key) ? "[REDACTED]" : redact(item),
      ]),
    );
  }
  if (typeof value === "string") {
    return value
      .replace(/([?&\s](?:token|key|signature|secret)=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[REDACTED]");
  }
  return value;
}
