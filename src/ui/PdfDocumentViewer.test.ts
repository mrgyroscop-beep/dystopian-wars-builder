import { describe, expect, it } from "vitest";

import { normalizePdfPageNumber } from "./PdfDocumentViewer";

describe("normalizePdfPageNumber", () => {
  it("keeps a valid pasted page number", () => {
    expect(normalizePdfPageNumber("55", 62, 1)).toBe(55);
  });

  it("clamps pasted values to the available document", () => {
    expect(normalizePdfPageNumber("0", 62, 20)).toBe(1);
    expect(normalizePdfPageNumber("999", 62, 20)).toBe(62);
  });

  it("keeps the current page for an empty or invalid value", () => {
    expect(normalizePdfPageNumber("", 62, 20)).toBe(20);
    expect(normalizePdfPageNumber("page 55", 62, 20)).toBe(20);
  });
});
