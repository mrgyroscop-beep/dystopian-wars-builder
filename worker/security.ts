const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_ERROR_NAME = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
  "Permissions-Policy": "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
} as const;

export function applyApiSecurityHeaders(headers: Headers): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
}

export function createSafeRequestId(candidate: string | undefined): string {
  return candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : crypto.randomUUID();
}

export function createSafeErrorName(error: unknown): string {
  return error instanceof Error && SAFE_ERROR_NAME.test(error.name) ? error.name : "UnknownError";
}

interface SafeErrorEvent {
  requestId: string;
  method: string;
  route: "api" | "other";
  errorName: string;
}

interface ErrorLogger {
  error(message: string): void;
}

export function writeSafeErrorLog(logger: ErrorLogger, event: SafeErrorEvent): void {
  logger.error(
    JSON.stringify({
      event: "worker_error",
      requestId: event.requestId,
      method: event.method,
      route: event.route,
      errorName: event.errorName,
    }),
  );
}
