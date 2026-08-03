const MAX_JSON_BYTES = 128 * 1024;

type RequestContext = {
  readonly req: {
    readonly method: string;
    readonly raw: Request;
    header(name: string): string | undefined;
    readonly url: string;
  };
};

export async function readBoundedJson(context: RequestContext): Promise<unknown> {
  const contentLength = Number(context.req.header("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_JSON_BYTES)
    throw new HttpError(413, "payload_too_large", "Request body is too large.");

  const stream = context.req.raw.body as ReadableStream<Uint8Array> | null;
  if (!stream) throw new HttpError(400, "invalid_json", "A JSON request body is required.");
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new HttpError(413, "payload_too_large", "Request body is too large.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function assertSameOrigin(context: RequestContext): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(context.req.method)) return;
  const origin = context.req.header("origin");
  if (!origin || origin !== new URL(context.req.url).origin)
    throw new HttpError(403, "invalid_origin", "The request origin is not allowed.");
}

export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function randomToken(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}
