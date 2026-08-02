# Domain boundary

KAN-31 defines a normalized, UI-independent catalogue model in `catalog/`.
The model accepts the lossless KAN-30 graph through a public input port and
does not import React, browser APIs, Hono, Cloudflare APIs, Node built-ins, or
the Node-only importer. Zod is used only by the public validation schemas;
normalization and canonical serialization remain platform-neutral.

The normalized layer preserves source semantics and provenance. It does not
calculate effective cardinality, availability, totals, validation results, or
modifier effects; those evaluator responsibilities belong to KAN-32.

Shared definitions are referenced by placements. A placement owns its local
costs, constraints, modifiers, categories, source order, and provenance, so a
shared definition is never cloned or mutated. Unknown evaluator-sensitive
operators, fields, or scopes remain present and are marked `evaluable:false`.

Consumers receive explicit `identity`, `labels`, typed cost semantics, declarative
slot cardinality, and full source/import/schema provenance contracts. Rich text
is exposed as safe paragraph, list, table, emphasis, strong, line-break, and
resolved/unresolved reference nodes; unsupported input remains visible through
diagnostics and the plain-text fallback.

Persistence uses the `dwb-domain-catalog` envelope. Core, glossary, and eight
faction indexes are content-addressed, while entity records are assigned by
successive SHA-256 bytes and split again only when a 512 KiB bucket budget is
exceeded. Repository loading validates the manifest, payload schemas, hashes,
bucket membership, lookup coverage, views, and full reference closure before
returning a catalogue.

Upstream redistribution is not licensed yet. Real `.cat`/`.gst` inputs may be
used only from ignored caches for pinned integration checks. Domain fixtures
in Git are synthetic, and committed evidence contains hashes, counts, and
pass/fail data only.
