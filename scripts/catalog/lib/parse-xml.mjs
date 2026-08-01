import { createReadStream } from "node:fs";
import { SaxesParser } from "saxes";
import { CatalogImportError } from "./errors.mjs";
import { toSafeRichText } from "./rich-text.mjs";

const limits = Object.freeze({
  depth: 32,
  elements: 150_000,
  attributes: 128,
  attributeChars: 256 * 1024,
  textChars: 256 * 1024,
  ids: 50_000,
  references: 100_000,
  parseMs: 30_000,
});
const richTextTags = new Set(["comment", "description"]);

export async function parseCatalogSource(source, options = {}) {
  const parser = new SaxesParser({ xmlns: true, fragment: false });
  const stack = [];
  const ids = new Map();
  const references = [];
  let root;
  let elementCount = 0;
  let rollingGuard = "";
  let parsingError;
  let idCount = 0;
  const now = options.now ?? Date.now;
  const started = now();

  parser.on("doctype", () => fail("XML_DTD_REJECTED", "DTD declarations are not allowed"));
  parser.on("processinginstruction", (instruction) => {
    if (instruction.target.toLowerCase() !== "xml")
      fail("XML_PI_REJECTED", "Processing instructions are not allowed");
  });
  parser.on("error", (error) => {
    parsingError ??= new CatalogImportError("XML_INVALID", "Catalog XML is not well formed", {
      path: source.path,
      reason: error.message,
    });
  });
  parser.on("opentag", (tag) => {
    elementCount += 1;
    if (elementCount > limits.elements)
      fail("XML_ELEMENT_LIMIT", "Catalog XML contains too many elements");
    if (stack.length >= limits.depth)
      fail("XML_DEPTH_LIMIT", "Catalog XML exceeds the nesting limit");
    const attributes = {};
    const entries = Object.entries(tag.attributes);
    if (entries.length > limits.attributes)
      fail("XML_ATTRIBUTE_LIMIT", "Catalog XML element has too many attributes");
    for (const [key, raw] of entries) {
      const value = (typeof raw === "string" ? raw : raw.value).normalize("NFC");
      if (value.length > limits.attributeChars)
        fail("XML_ATTRIBUTE_LIMIT", "Catalog XML attribute is too long");
      if (key !== "xmlns") attributes[key] = value;
    }
    const parent = stack.at(-1);
    const id = attributes.id;
    const occurrence = id ? (ids.get(id)?.length ?? 0) + 1 : undefined;
    const node = {
      key: id ? `${source.path}:${id}:${occurrence}` : `${source.path}:path:${elementCount}`,
      tag: tag.local,
      namespace: tag.uri,
      attributes,
      children: [],
      text: "",
    };
    if (id) {
      idCount += 1;
      if (idCount > limits.ids) fail("XML_ID_LIMIT", "Catalog XML contains too many ids");
      const existing = ids.get(id) ?? [];
      existing.push(node.key);
      ids.set(id, existing);
    }
    if (attributes.targetId) {
      references.push({ sourceKey: node.key, targetId: attributes.targetId });
      if (references.length > limits.references)
        fail("XML_REFERENCE_LIMIT", "Catalog XML contains too many references");
    }
    if (parent) parent.children.push(node);
    else if (root) fail("XML_MULTIPLE_ROOTS", "Catalog XML has multiple root elements");
    else root = node;
    stack.push(node);
  });
  parser.on("text", (text) => appendText(text));
  parser.on("cdata", (text) => appendText(text));
  parser.on("closetag", () => {
    const node = stack.pop();
    if (!node) return;
    node.text = node.text.normalize("NFC").trim();
    if (richTextTags.has(node.tag) && node.text) {
      node.richText = toSafeRichText(node.text);
      delete node.text;
    } else if (!node.text) delete node.text;
    if (node.children.length === 0) delete node.children;
  });

  try {
    for await (const chunk of createReadStream(source.file, {
      encoding: "utf8",
      highWaterMark: 64 * 1024,
    })) {
      const guard = `${rollingGuard}${chunk}`;
      if (/<!\s*(?:DOCTYPE|ENTITY)\b/iu.test(guard))
        fail("XML_DTD_REJECTED", "DTD and entity declarations are not allowed");
      if (/<(?:[A-Za-z_][\w.-]*:)?include\b[^>]*(?:href|xpointer)\s*=/iu.test(guard)) {
        fail("XML_XINCLUDE_REJECTED", "XInclude-like elements are not allowed");
      }
      rollingGuard = guard.slice(-256);
      parser.write(chunk);
      if (now() - started > limits.parseMs)
        fail("XML_PARSE_TIMEOUT", "Catalog XML exceeded the hard parse timeout");
      if (parsingError) throw parsingError;
    }
    parser.close();
    if (parsingError) throw parsingError;
  } catch (error) {
    if (error instanceof CatalogImportError) throw error;
    throw new CatalogImportError("XML_READ", "Catalog XML could not be parsed", {
      path: source.path,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (!root || stack.length !== 0)
    throw new CatalogImportError("XML_INVALID", "Catalog XML does not have one complete root", {
      path: source.path,
    });
  if (!new Set(["gameSystem", "catalogue"]).has(root.tag)) {
    throw new CatalogImportError("XML_ROOT_REJECTED", "Unexpected catalog XML root", {
      path: source.path,
      root: root.tag,
    });
  }
  const expectedNamespace =
    root.tag === "gameSystem"
      ? "http://www.battlescribe.net/schema/gameSystemSchema"
      : "http://www.battlescribe.net/schema/catalogueSchema";
  if (root.namespace !== expectedNamespace) {
    throw new CatalogImportError("XML_NAMESPACE_REJECTED", "Unexpected catalog XML namespace", {
      path: source.path,
      expected: expectedNamespace,
      actual: root.namespace,
    });
  }
  return {
    path: source.path,
    blob: source.blob,
    sha256: source.sha256,
    root,
    ids: Object.fromEntries([...ids].sort(([left], [right]) => left.localeCompare(right))),
    references,
    statistics: {
      elements: elementCount,
      ids: idCount,
      uniqueIds: ids.size,
      references: references.length,
    },
  };

  function appendText(text) {
    const node = stack.at(-1);
    if (!node) return;
    node.text += text;
    if (node.text.length > limits.textChars)
      fail("XML_TEXT_LIMIT", "Catalog XML text node exceeds the configured limit");
  }

  function fail(code, message) {
    const error = new CatalogImportError(code, message, { path: source.path });
    parsingError ??= error;
    throw error;
  }
}
