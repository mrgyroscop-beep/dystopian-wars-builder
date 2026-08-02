import type { RichTextBlock, RichTextInline, SafePresentation } from "./types";

const removedContainers =
  /<(script|style|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/giu;
const tags = /<[^>]*>/gu;
const executableProtocol = /\b(?:javascript|data|vbscript)\s*:/giu;
const entityPattern = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/giu;

export function toSafePresentation(value: unknown): SafePresentation {
  const diagnostics = new Set<string>();
  let text = typeof value === "string" ? value : "";
  text = decodeEntities(text);
  text = text.replace(removedContainers, () => {
    diagnostics.add("PRESENTATION_EXECUTABLE_CONTENT_REMOVED");
    return " ";
  });
  text = text.replace(executableProtocol, () => {
    diagnostics.add("PRESENTATION_EXECUTABLE_LINK_REMOVED");
    return "blocked:";
  });
  text = text.replace(tags, () => {
    diagnostics.add("PRESENTATION_MARKUP_REMOVED");
    return " ";
  });
  text = text.normalize("NFC").replace(/\s+/gu, " ").trim();
  const children: RichTextInline[] = text ? [{ type: "text", value: text }] : [];
  return {
    plainText: text,
    blocks: children.length > 0 ? [{ type: "paragraph", children }] : [],
    contentUnavailable: text.length === 0 && diagnostics.size > 0,
    diagnostics: [...diagnostics].sort(),
  };
}

export function presentationFromNode(
  value: unknown,
  richText?: {
    readonly plainText?: string;
    readonly contentUnavailable?: boolean;
    readonly children?: readonly unknown[];
    readonly diagnostics?: readonly { readonly code?: string }[];
  },
): SafePresentation {
  const safe = toSafePresentation(richText?.plainText ?? value);
  const diagnostics = new Set([
    ...safe.diagnostics,
    ...(richText?.diagnostics ?? []).flatMap((diagnostic) =>
      diagnostic.code ? [diagnostic.code] : [],
    ),
  ]);
  const blocks = richText?.children ? safeBlocks(richText.children, diagnostics) : safe.blocks;
  return {
    ...safe,
    blocks,
    contentUnavailable: (richText?.contentUnavailable ?? false) && safe.plainText.length === 0,
    diagnostics: [...diagnostics].sort(),
  };
}

function safeBlocks(
  children: readonly unknown[],
  diagnostics: Set<string>,
): readonly RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  for (const candidate of children) {
    const block = record(candidate);
    if (block?.type === "paragraph") {
      blocks.push({
        type: "paragraph",
        children: safeInline(array(block.children), diagnostics),
      });
      continue;
    }
    if (block?.type === "table") {
      blocks.push({
        type: "table",
        rows: array(block.rows).flatMap((rowCandidate) => {
          const row = record(rowCandidate);
          if (row?.type !== "tableRow") return [];
          return [
            {
              type: "tableRow" as const,
              cells: array(row.cells).flatMap((cellCandidate) => {
                const cell = record(cellCandidate);
                if (cell?.type !== "tableCell") return [];
                return [
                  {
                    type: "tableCell" as const,
                    header: cell.header === true,
                    children: safeInline(array(cell.children), diagnostics),
                  },
                ];
              }),
            },
          ];
        }),
      });
      continue;
    }
    if (
      block?.type === "list" ||
      block?.type === "orderedList" ||
      block?.type === "unorderedList"
    ) {
      blocks.push({
        type: "list",
        ordered: block.type === "orderedList" || block.ordered === true,
        items: array(block.items ?? block.children).flatMap((itemCandidate) => {
          const item = record(itemCandidate);
          if (item?.type !== "listItem") {
            diagnostics.add("PRESENTATION_UNSUPPORTED_LIST_ITEM");
            return [];
          }
          const children = array(item.children).flatMap((child) => {
            const nested = record(child);
            return nested?.type === "paragraph" ? array(nested.children) : [child];
          });
          return [
            {
              type: "listItem" as const,
              children: safeInline(children, diagnostics),
            },
          ];
        }),
      });
      continue;
    }
    diagnostics.add("PRESENTATION_UNSUPPORTED_BLOCK");
  }
  return blocks;
}

function safeInline(
  children: readonly unknown[],
  diagnostics: Set<string>,
): readonly RichTextInline[] {
  const inlines: RichTextInline[] = [];
  for (const candidate of children) {
    const inline = record(candidate);
    if (inline?.type === "lineBreak") {
      inlines.push({ type: "lineBreak" });
      continue;
    }
    if (
      (inline?.type === "text" || inline?.type === "strong" || inline?.type === "emphasis") &&
      (typeof inline.value === "string" || Array.isArray(inline.children))
    ) {
      const rawValue =
        typeof inline.value === "string"
          ? inline.value
          : array(inline.children)
              .map((child) => record(child)?.value)
              .filter((value): value is string => typeof value === "string")
              .join("");
      const value = sanitizeInlineText(rawValue);
      if (value) inlines.push({ type: inline.type, value });
      continue;
    }
    if (inline?.type === "reference") {
      const targetValue = inline.targetEntityId ?? inline.targetId ?? inline.target ?? "";
      const target = typeof targetValue === "string" ? sanitizeInlineText(targetValue) : "";
      const rawLabel = typeof inline.value === "string" ? inline.value : target;
      const value = sanitizeInlineText(rawLabel);
      const state =
        inline.resolved === true || typeof inline.targetEntityId === "string"
          ? "resolved"
          : "unresolved";
      if (state === "unresolved") diagnostics.add("PRESENTATION_REFERENCE_UNRESOLVED");
      inlines.push({ type: "reference", value, reference: { state, target } });
      continue;
    }
    diagnostics.add("PRESENTATION_UNSUPPORTED_INLINE");
  }
  return inlines;
}

function sanitizeInlineText(value: string): string {
  return decodeEntities(value)
    .replace(removedContainers, " ")
    .replace(executableProtocol, "blocked:")
    .replace(tags, " ")
    .replace(/\r\n?/gu, "\n")
    .normalize("NFC");
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function array(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function decodeEntities(value: string): string {
  return value.replace(entityPattern, (match, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith("#x")) return fromCodePoint(Number.parseInt(lower.slice(2), 16), match);
    if (lower.startsWith("#")) return fromCodePoint(Number.parseInt(lower.slice(1), 10), match);
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[lower] ?? match;
  });
}

function fromCodePoint(value: number, fallback: string): string {
  try {
    return Number.isFinite(value) && value >= 0 && value <= 0x10ffff
      ? String.fromCodePoint(value)
      : fallback;
  } catch {
    return fallback;
  }
}
