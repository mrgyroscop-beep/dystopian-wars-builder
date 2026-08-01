import { describe, expect, it } from "vitest";
import lock from "../source-lock.json" with { type: "json" };
import { redact } from "./errors.mjs";
import { toSafeRichText } from "./rich-text.mjs";
import { validateSourceLock } from "./source-lock.mjs";

describe("source lock and safe content", () => {
  it("accepts the exact pinned ten-file inventory", () => {
    const validated = validateSourceLock(lock);
    expect(validated.files).toHaveLength(10);
    expect(validated.commit).toHaveLength(40);
    expect(validated.files.map((file) => file.path)).toContain("Rules Glossary.cat");
  });

  it("rejects repository and traversal changes", () => {
    expect(() => validateSourceLock({ ...lock, repository: "attacker/repo" })).toThrow(/invalid/u);
    expect(() =>
      validateSourceLock({
        ...lock,
        files: lock.files.map((file, index) =>
          index === 0 ? { ...file, path: "../secret.cat" } : file,
        ),
      }),
    ).toThrow(/invalid/u);
    expect(() => validateSourceLock({ ...lock, note: "mutable" })).toThrow(/invalid/u);
  });

  it("converts embedded markup to a structured text-only AST", () => {
    const result = toSafeRichText(
      '<p>Hello <strong>captain</strong></p><script data-token="secret">steal()</script><br>Ready',
    );
    expect(result).toEqual({
      type: "document",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "Hello captain" }] },
        { type: "paragraph", children: [{ type: "text", value: "Ready" }] },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("<strong>");
    expect(JSON.stringify(result)).not.toContain("steal");
  });

  it("redacts credentials and signed query values", () => {
    expect(
      redact({ authorization: "Bearer abc", url: "https://example.test/a?token=abc&ok=1" }),
    ).toEqual({
      authorization: "[REDACTED]",
      url: "https://example.test/a?token=[REDACTED]&ok=1",
    });
  });
});
