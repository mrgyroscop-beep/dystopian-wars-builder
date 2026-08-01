import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseCatalogSource } from "./parse-xml.mjs";

const temporary = [];
afterEach(async () =>
  Promise.all(
    temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

describe("streaming XML boundary", () => {
  it("normalizes a valid catalogue and scopes duplicate ids deterministically", async () => {
    const source = await fixture(
      '<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="cat" name="Test" revision="1" gameSystemId="sys"><rules><rule id="same" name="A"><description>&lt;b&gt;Safe&lt;/b&gt;</description></rule><rule id="same" name="B"/></rules></catalogue>',
    );
    const parsed = await parseCatalogSource(source);
    expect(parsed.ids.same).toEqual(["fixture.cat:same:1", "fixture.cat:same:2"]);
    expect(JSON.stringify(parsed.root)).not.toContain("<b>");
  });

  it.each([
    [
      "DTD",
      '<!DOCTYPE catalogue [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="x" name="x" revision="1">&xxe;</catalogue>',
      "XML_DTD_REJECTED",
    ],
    [
      "XInclude",
      '<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="x" name="x" revision="1"><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///x"/></catalogue>',
      "XML_XINCLUDE_REJECTED",
    ],
    [
      "processing instruction",
      '<?xml version="1.0"?><catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="x" name="x" revision="1"><?load secret?></catalogue>',
      "XML_PI_REJECTED",
    ],
  ])("rejects %s payloads", async (_label, xml, code) => {
    await expect(parseCatalogSource(await fixture(xml))).rejects.toMatchObject({ code });
  });

  it("rejects over-deep documents", async () => {
    const xml = `<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="x" name="x" revision="1">${"<x>".repeat(33)}${"</x>".repeat(33)}</catalogue>`;
    await expect(parseCatalogSource(await fixture(xml))).rejects.toMatchObject({
      code: "XML_DEPTH_LIMIT",
    });
  });

  it("rejects text above 256 KiB", async () => {
    const xml = `<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="x" name="x" revision="1"><description>${"x".repeat(256 * 1024 + 1)}</description></catalogue>`;
    await expect(parseCatalogSource(await fixture(xml))).rejects.toMatchObject({
      code: "XML_TEXT_LIMIT",
    });
  });

  it("rejects an attribute value above 256 KiB", async () => {
    const xml = `<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="x" name="${"x".repeat(256 * 1024 + 1)}" revision="1"/>`;
    await expect(parseCatalogSource(await fixture(xml))).rejects.toMatchObject({
      code: "XML_ATTRIBUTE_LIMIT",
    });
  });

  it("rejects more than 150,000 elements", async () => {
    const xml = `<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="root" name="x" revision="1">${"<x/>".repeat(150_000)}</catalogue>`;
    await expect(parseCatalogSource(await fixture(xml))).rejects.toMatchObject({
      code: "XML_ELEMENT_LIMIT",
    });
  });

  it("rejects more than 50,000 ids", async () => {
    const entries = Array.from({ length: 50_001 }, (_, index) => `<x id="id-${index}"/>`).join("");
    const xml = `<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="root" name="x" revision="1">${entries}</catalogue>`;
    await expect(parseCatalogSource(await fixture(xml))).rejects.toMatchObject({
      code: "XML_ID_LIMIT",
    });
  });

  it("rejects more than 100,000 target references", async () => {
    const xml = `<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="root" name="x" revision="1">${'<x targetId="target"/>'.repeat(100_001)}</catalogue>`;
    await expect(parseCatalogSource(await fixture(xml))).rejects.toMatchObject({
      code: "XML_REFERENCE_LIMIT",
    });
  });

  it("rejects duplicate XML attributes and an unexpected root namespace", async () => {
    await expect(
      parseCatalogSource(
        await fixture(
          '<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="x" id="y" name="x" revision="1"/>',
        ),
      ),
    ).rejects.toMatchObject({ code: "XML_INVALID" });
    await expect(
      parseCatalogSource(
        await fixture(
          '<catalogue xmlns="https://attacker.test/schema" id="x" name="x" revision="1"/>',
        ),
      ),
    ).rejects.toMatchObject({ code: "XML_NAMESPACE_REJECTED" });
  });

  it("enforces a 30 second hard parse deadline", async () => {
    const clock = [0, 30_001];
    const source = await fixture(
      '<catalogue xmlns="http://www.battlescribe.net/schema/catalogueSchema" id="x" name="x" revision="1"/>',
    );
    await expect(
      parseCatalogSource(source, { now: () => clock.shift() ?? 30_001 }),
    ).rejects.toMatchObject({
      code: "XML_PARSE_TIMEOUT",
    });
  });
});

async function fixture(xml) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "catalog-xml-"));
  temporary.push(directory);
  const file = path.join(directory, "fixture.cat");
  await writeFile(file, xml);
  return { path: "fixture.cat", file, blob: "a".repeat(40), sha256: "b".repeat(64) };
}
