import { Hono } from "hono";

import { HttpError } from "./http";

const documents = {
  "rules-4-00": {
    filename: "dystopian-wars-rules-4-00.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/pdfs/essentials/DW-Rule-Book-4.00_Full_W.pdf",
  },
  "glossary-4-03a": {
    filename: "dystopian-wars-glossary-4-03a.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/pdfs/essentials/DW4-Rules-Glossary-v4.03a_W.pdf",
  },
  "quick-reference": {
    filename: "dystopian-wars-quick-reference.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/pdfs/essentials/Quick-Reference-Guide_W.pdf",
  },
} as const;

export const referencePdfRoutes = new Hono<{ Bindings: Env }>();

referencePdfRoutes.get("/:documentId", async (context) => {
  const document = resolveReferenceDocument(context.req.param("documentId"));
  if (!document) throw new HttpError(404, "document_not_found", "Document not found.");

  const requestHeaders = new Headers();
  const range = context.req.header("range");
  if (range) requestHeaders.set("Range", range);

  const upstream = await fetch(document.url, { headers: requestHeaders });
  if (!upstream.ok && upstream.status !== 206)
    throw new HttpError(503, "document_unavailable", "Document is temporarily unavailable.");

  const headers = new Headers({
    "Cache-Control": "public, max-age=3600, s-maxage=86400",
    "Content-Disposition": `inline; filename="${document.filename}"`,
    "Content-Security-Policy": "frame-ancestors 'self'",
    "Content-Type": "application/pdf",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
  });
  for (const name of [
    "accept-ranges",
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(upstream.body, { headers, status: upstream.status });
});

export function resolveReferenceDocument(documentId: string) {
  return Object.hasOwn(documents, documentId)
    ? documents[documentId as keyof typeof documents]
    : null;
}
