# ADR-0005: Normalized catalogue domain model

## Status

Accepted for KAN-31.

## Decision

The application consumes KAN-30's lossless graph through a pure normalization
boundary. Canonical entity identities are scoped to the document root and
source tag. Duplicate upstream IDs receive an occurrence suffix; source nodes
without an upstream ID are explicitly marked synthetic.
Every canonical segment is injectively percent-encoded, and any remaining
canonical/source-node collision aborts normalization instead of overwriting a
record.

Definitions, placements, and slots are separate records. Ownership and source
links become ordered placements, and link-local overlays remain on the
placement. This allows shared and local definitions to use one representation
without target cloning.

Costs use decimal strings and explicit missing, unknown, not-applicable, zero,
and value states. Conditions, groups, constraints, modifiers, and repeats
preserve raw operators, fields, scopes, values, references, flags, and order.
Unknown semantics are not defaulted or evaluated.

Public entities, amounts, expressions, fields, placements, slots, aliases,
extensions, and reference resolutions carry a versioned contract discriminator.
Unknown source subtrees are retained as lossless extensions. Safe rich-text
paragraph/table AST, complete provenance, explicit labels/aliases, and
resolved/unresolved/ambiguous reference chains remain available to consumers.
Unresolved or ambiguous required links are fatal by default; an explicit
`report` policy exists for diagnostic tooling.

Semantic classification is structural: the pinned, versioned DW4 vocabulary
uses upstream IDs and profile type IDs, and hardpoints are inferred from their
weapon-profile descendants. Display names are never classification inputs.

Every record carries the pinned repository commit/tree and source document
blob/hash. Canonical serialization produces content-addressed chunks no larger
than 512 KiB plus lookup indexes and a schema-semver/content-version contract.
Migration aliases are accepted only when explicitly supplied by upstream;
ambiguous explicit aliases remain visible rather than being resolved fuzzily.
Reader, normalizer, writer, and repository ports keep import, normalization,
persistence, and loading independently replaceable. Repository loading verifies
descriptor integrity, content version, schema, indexes, lookup coverage, and
cross-record reference closure before exposing a catalogue.

## Consequences

- UI, Worker, and Node importer runtimes are not dependencies of the model.
- Presentation fields expose sanitized structured/plain text and never raw
  HTML or executable links.
- KAN-32 is solely responsible for evaluation and roster legality.
- Until the upstream license is confirmed, source XML and real-derived domain
  payloads cannot be committed, bundled, or deployed.
