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

Upstream redistribution is not licensed yet. Real `.cat`/`.gst` inputs may be
used only from ignored caches for pinned integration checks. Domain fixtures
in Git are synthetic, and committed evidence contains hashes, counts, and
pass/fail data only.
