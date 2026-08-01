const blockTags = new Set(["p", "div"]);
const tableContainerTags = new Set(["thead", "tbody", "tfoot"]);
const ignoredContainers = /<\/?(?:script|style)\b[^>]*>[\s\S]*?(?:<\/(?:script|style)>|$)/giu;

export function toSafeRichText(source) {
  const diagnostics = new Map();
  let value = String(source ?? "");
  value = value.replace(ignoredContainers, (removed) => {
    note("RICH_TEXT_CONTENT_REMOVED", tagName(removed));
    return " ";
  });

  const blocks = [];
  let paragraph = [];
  let strongDepth = 0;
  let table;
  let row;
  let cell;
  let nestedTableDepth = 0;
  let offset = 0;
  const tags = /<\/?([A-Za-z0-9]+)([^>]*)>/gu;
  for (const match of value.matchAll(tags)) {
    appendText(decodeEntities(value.slice(offset, match.index)));
    const name = match[1].toLowerCase();
    const closing = match[0].startsWith("</");
    if (blockTags.has(name)) {
      if (!table) flushParagraph();
    } else if (name === "br" && !closing) {
      appendInline({ type: "lineBreak" });
    } else if (name === "strong" || name === "b") {
      strongDepth = closing ? Math.max(0, strongDepth - 1) : strongDepth + 1;
    } else if (name === "table") {
      if (closing && nestedTableDepth > 0) nestedTableDepth -= 1;
      else if (closing) closeTable();
      else if (table) {
        nestedTableDepth += 1;
        note("RICH_TEXT_MEANINGFUL_LOSS", "nested-table");
      } else openTable();
    } else if (name === "tr") {
      if (closing) closeRow();
      else openRow();
    } else if (name === "td" || name === "th") {
      if (closing) closeCell();
      else openCell(name === "th");
    } else if (name === "img" && !closing) {
      const alternative = /\balt\s*=\s*["']([^"']*)["']/iu.exec(match[2])?.[1];
      if (alternative) appendText(decodeEntities(alternative));
      note("RICH_TEXT_MEANINGFUL_LOSS", "img");
    } else if (!new Set(["ul", "ol", "li"]).has(name) && !tableContainerTags.has(name)) {
      note("RICH_TEXT_MEANINGFUL_LOSS", name);
    } else if (name === "li" && closing) {
      appendInline({ type: "lineBreak" });
    }
    offset = match.index + match[0].length;
  }
  appendText(decodeEntities(value.slice(offset)));
  closeTable();
  flushParagraph();

  const plainText = blocks.map(blockPlainText).filter(Boolean).join("\n");
  const result = {
    type: "document",
    children: blocks,
    plainText,
    contentUnavailable:
      plainText.length === 0 &&
      [...diagnostics.values()].some(
        (diagnostic) => diagnostic.code === "RICH_TEXT_CONTENT_REMOVED",
      ),
    diagnostics: [...diagnostics.values()].sort((left, right) =>
      `${left.code}:${left.tag}`.localeCompare(`${right.code}:${right.tag}`),
    ),
  };
  return result;

  function currentInline() {
    return cell?.children ?? paragraph;
  }

  function appendText(text) {
    const normalized = text.replace(/\s+/gu, " ");
    if (normalized.length === 0) return;
    if (!normalized.trim()) {
      const inline = currentInline();
      const previous = inline.at(-1);
      if (previous?.type === "text" || previous?.type === "strong") previous.value += " ";
      return;
    }
    appendInline({ type: strongDepth > 0 ? "strong" : "text", value: normalized });
  }

  function appendInline(node) {
    const inline = currentInline();
    const previous = inline.at(-1);
    if (node.type !== "lineBreak" && previous?.type === node.type) previous.value += node.value;
    else inline.push(node);
  }

  function flushParagraph() {
    trimInline(paragraph);
    if (paragraph.length > 0) blocks.push({ type: "paragraph", children: paragraph });
    paragraph = [];
  }

  function openTable() {
    flushParagraph();
    table = { type: "table", rows: [] };
  }

  function closeTable() {
    if (!table) return;
    closeRow();
    if (table.rows.length > 0) blocks.push(table);
    table = undefined;
  }

  function openRow() {
    if (!table) {
      note("RICH_TEXT_MEANINGFUL_LOSS", "tr");
      return;
    }
    closeRow();
    row = { type: "tableRow", cells: [] };
  }

  function closeRow() {
    closeCell();
    if (table && row) table.rows.push(row);
    row = undefined;
  }

  function openCell(header) {
    if (!row) {
      note("RICH_TEXT_MEANINGFUL_LOSS", header ? "th" : "td");
      return;
    }
    closeCell();
    cell = { type: "tableCell", header, children: [] };
  }

  function closeCell() {
    if (!cell) return;
    trimInline(cell.children);
    if (row) row.cells.push(cell);
    cell = undefined;
  }

  function note(code, tag) {
    diagnostics.set(`${code}:${tag}`, { code, tag });
  }
}

function trimInline(inline) {
  const first = inline[0];
  const last = inline.at(-1);
  if (first && "value" in first) first.value = first.value.trimStart();
  if (last && "value" in last) last.value = last.value.trimEnd();
  while (inline[0] && "value" in inline[0] && inline[0].value.length === 0) inline.shift();
  while (inline.at(-1) && "value" in inline.at(-1) && inline.at(-1).value.length === 0)
    inline.pop();
}

function blockPlainText(block) {
  if (block.type === "paragraph") return inlinePlainText(block.children);
  return block.rows
    .map((row) => row.cells.map((currentCell) => inlinePlainText(currentCell.children)).join("\t"))
    .join("\n");
}

function inlinePlainText(children) {
  return children.map((child) => (child.type === "lineBreak" ? "\n" : child.value)).join("");
}

function tagName(value) {
  return /<\/?([A-Za-z0-9]+)/u.exec(value)?.[1]?.toLowerCase() ?? "unknown";
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
