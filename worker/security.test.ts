import { describe, expect, it, vi } from "vitest";

import { createSafeErrorName, createSafeRequestId, writeSafeErrorLog } from "./security";

describe("Worker diagnostic redaction", () => {
  it("accepts only bounded opaque request ids", () => {
    expect(createSafeRequestId("safe-Ray_123")).toBe("safe-Ray_123");
    expect(createSafeRequestId("C:\\secret\\token.txt Authorization: Bearer abc")).not.toContain(
      "secret",
    );
    expect(createSafeErrorName(new DOMException("private detail", "OperationError"))).toBe(
      "OperationError",
    );
    expect(createSafeErrorName({ name: "Authorization: Bearer abc" })).toBe("UnknownError");
  });

  it("serializes only allowlisted operational fields", () => {
    const logger = { error: vi.fn<(message: string) => void>() };
    writeSafeErrorLog(logger, {
      requestId: "request-1",
      method: "POST",
      route: "api",
      errorName: "OperationError",
    });

    const record = logger.error.mock.calls[0]?.[0];
    expect(record).toBeDefined();
    expect(JSON.parse(record ?? "{}")).toEqual({
      event: "worker_error",
      requestId: "request-1",
      method: "POST",
      route: "api",
      errorName: "OperationError",
    });
    expect(record).not.toMatch(/authorization|cookie|body|filesystem|token|account/i);
  });
});
