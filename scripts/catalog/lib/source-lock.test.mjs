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
      "<p>Hello <strong>captain</strong><br>Ready</p><table><tr><th>Ship</th><td>Akita</td></tr></table>",
    );
    expect(result.plainText).toBe("Hello captain\nReady\nShip\tAkita");
    expect(result.children[0].children.map((child) => child.type)).toEqual([
      "text",
      "strong",
      "lineBreak",
      "text",
    ]);
    expect(result.children[1]).toMatchObject({
      type: "table",
      rows: [{ cells: [{ header: true }, { header: false }] }],
    });
    expect(JSON.stringify(result)).not.toContain("<strong>");
    expect(result.diagnostics).toEqual([]);
  });

  it("uses deterministic plain fallback and reports hostile or lossy content", () => {
    const unavailable = toSafeRichText(
      '<script src="https://attacker.test/x" onload="steal()">secret</script>',
    );
    expect(unavailable).toMatchObject({
      plainText: "",
      contentUnavailable: true,
      diagnostics: [{ code: "RICH_TEXT_CONTENT_REMOVED", tag: "script" }],
    });
    expect(JSON.stringify(unavailable)).not.toContain("attacker");
    expect(JSON.stringify(unavailable)).not.toContain("steal");

    const fallback = toSafeRichText(
      '<marquee onclick="steal()">Important</marquee><img src="javascript:steal()" alt="Diagram">',
    );
    expect(fallback.plainText).toBe("ImportantDiagram");
    expect(fallback.contentUnavailable).toBe(false);
    expect(fallback.diagnostics.map((item) => item.code)).toEqual([
      "RICH_TEXT_MEANINGFUL_LOSS",
      "RICH_TEXT_MEANINGFUL_LOSS",
    ]);
    expect(JSON.stringify(fallback)).not.toContain("javascript:");
    expect(JSON.stringify(fallback)).not.toContain("onclick");

    const nestedTable = toSafeRichText(
      "<table><tr><td>Outer<table><tr><td>Inner</td></tr></table>End</td></tr></table>",
    );
    expect(nestedTable.plainText).toContain("Outer");
    expect(nestedTable.diagnostics).toContainEqual({
      code: "RICH_TEXT_MEANINGFUL_LOSS",
      tag: "nested-table",
    });
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
