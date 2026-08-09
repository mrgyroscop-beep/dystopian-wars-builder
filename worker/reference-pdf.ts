import { Hono } from "hono";

import { HttpError } from "./http";

const documents = {
  "rules-4-00": {
    filename: "dystopian-wars-rules-4-00.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/pdfs/essentials/DW-Rule-Book-4.00_Full_W.pdf",
  },
  "glossary-4-03b": {
    filename: "dystopian-wars-glossary-4-03b.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/pdfs/essentials/DW4-Rules-Glossary-v4.03b_W.pdf",
  },
  "quick-reference": {
    filename: "dystopian-wars-quick-reference.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/pdfs/essentials/Quick-Reference-Guide_W.pdf",
  },
  "orbat-alliance": {
    filename: "dystopian-wars-orbat-alliance-4-01-beta.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Alliance-4.01-Beta_W.pdf",
  },
  "orbat-commonwealth": {
    filename: "dystopian-wars-orbat-commonwealth-4-00a.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Commonwealth-400a_W.pdf",
  },
  "orbat-crown": {
    filename: "dystopian-wars-orbat-crown-4-02a.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Crown_Full-4.02a.pdf",
  },
  "orbat-empire": {
    filename: "dystopian-wars-orbat-empire-4-01.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Empire_Full-4.01_W.pdf",
  },
  "orbat-enlightened": {
    filename: "dystopian-wars-orbat-enlightened-4-01-beta-2.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Enlightened-v4.01-Beta2_W.pdf",
  },
  "orbat-imperium": {
    filename: "dystopian-wars-orbat-imperium-4-00b.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Imperium-400b_W.pdf",
  },
  "orbat-sultanate": {
    filename: "dystopian-wars-orbat-sultanate-4-01.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Sultanate-4.01_W.pdf",
  },
  "orbat-union": {
    filename: "dystopian-wars-orbat-union-4-00a.pdf",
    url: "https://www.warcradle.com/assets/warcradleGames/dystopianWars/factions/orbat/DW-ORBATS_Union-4.00a_W.pdf",
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
