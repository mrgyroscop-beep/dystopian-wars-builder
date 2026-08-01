import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { healthResponseSchema } from "../src/application/health/health-contract";

describe("Worker API", () => {
  it("returns a validated health response", async () => {
    const response = await exports.default.fetch("http://example.com/api/health");
    const payload: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(healthResponseSchema.parse(payload)).toEqual({
      status: "ok",
      environment: "local",
      appVersion: "0.1.0",
      catalogVersion: "not-imported",
      commitSha: "0000000000000000000000000000000000000000",
    });

    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("permissions-policy")).toContain("camera=()");
    expect(response.headers.get("x-robots-tag")).toContain("noindex");
  });

  it("returns JSON 404 for an unknown API route", async () => {
    const response = await exports.default.fetch("http://example.com/api/missing");
    const payload: unknown = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      error: {
        code: "not_found",
        message: "API route not found.",
      },
    });
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
