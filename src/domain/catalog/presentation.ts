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
  const blocks = richText?.children ? safeBlocks(richText.children) : safe.blocks;
  const diagnostics = new Set([
    ...safe.diagnostics,
    ...(richText?.diagnostics ?? []).flatMap((diagnostic) =>
      diagnostic.code ? [diagnostic.code] : [],
    ),
  ]);
  return {
    ...safe,
    blocks,
    contentUnavailable: (richText?.contentUnavailable ?? false) && safe.plainText.length === 0,
    diagnostics: [...diagnostics].sort(),
  };
}

function safeBlocks(children: readonly unknown[]): readonly RichTextBlock[] {
  const blocks: RichTextBlock[] = [];
  for (const candidate of children) {
    const block = record(candidate);
    if (block?.type === "paragraph") {
      blocks.push({ type: "paragraph", children: safeInline(array(block.children)) });
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
                    children: safeInline(array(cell.children)),
                  },
                ];
              }),
            },
          ];
        }),
      });
    }
  }
  return blocks;
}

function safeInline(children: readonly unknown[]): readonly RichTextInline[] {
  const inlines: RichTextInline[] = [];
  for (const candidate of children) {
    const inline = record(candidate);
    if (inline?.type === "lineBreak") {
      inlines.push({ type: "lineBreak" });
      continue;
    }
    if (
      (inline?.type === "text" || inline?.type === "strong") &&
      typeof inline.value === "string"
    ) {
      const value = sanitizeInlineText(inline.value);
      if (value) inlines.push({ type: inline.type, value });
    }
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
