const allowedBlocks = new Set(["p", "div", "br", "li", "ul", "ol"]);

export function toSafeRichText(source) {
  const value = String(source ?? "").replace(
    /<\/?(?:script|style)[^>]*>[\s\S]*?(?:<\/(?:script|style)>|$)/giu,
    " ",
  );
  const paragraphs = [];
  let current = "";
  let offset = 0;
  const tags = /<\/?([A-Za-z0-9]+)(?:\s[^>]*)?>/gu;
  for (const match of value.matchAll(tags)) {
    current += decodeEntities(value.slice(offset, match.index));
    const tag = match[1].toLowerCase();
    if (allowedBlocks.has(tag)) flush();
    offset = match.index + match[0].length;
  }
  current += decodeEntities(value.slice(offset));
  flush();
  if (paragraphs.length === 0) return { type: "document", children: [] };
  return {
    type: "document",
    children: paragraphs.map((text) => ({
      type: "paragraph",
      children: [{ type: "text", value: text }],
    })),
  };

  function flush() {
    const normalized = current.replace(/\s+/gu, " ").trim();
    if (normalized) paragraphs.push(normalized);
    current = "";
  }
}

function decodeEntities(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"', nbsp: " " };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, entity) => {
    if (entity[0] === "#") {
      const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
      const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
      const codePoint = Number.parseInt(digits, radix);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : "�";
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}
