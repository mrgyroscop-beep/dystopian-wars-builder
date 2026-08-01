import type { RichTextInline, SafePresentation } from "./types";

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
  richText?: { readonly plainText?: string; readonly contentUnavailable?: boolean },
): SafePresentation {
  const safe = toSafePresentation(richText?.plainText ?? value);
  return richText?.contentUnavailable && safe.plainText.length === 0
    ? { ...safe, contentUnavailable: true }
    : safe;
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
