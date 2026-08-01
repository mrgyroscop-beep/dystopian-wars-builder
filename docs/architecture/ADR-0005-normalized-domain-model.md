# ADR-0005: Normalized catalogue domain model

## Status

Accepted for KAN-31.

## Decision

The application consumes KAN-30's lossless graph through a pure normalization
boundary. Canonical entity identities are scoped to the document root and
source tag. Duplicate upstream IDs receive an occurrence suffix; source nodes
without an upstream ID are explicitly marked synthetic.

Definitions, placements, and slots are separate records. Ownership and source
links become ordered placements, and link-local overlays remain on the
placement. This allows shared and local definitions to use one representation
without target cloning.

Costs use decimal strings and explicit missing, unknown, not-applicable, zero,
and value states. Conditions, groups, constraints, modifiers, and repeats
preserve raw operators, fields, scopes, values, references, flags, and order.
Unknown semantics are not defaulted or evaluated.

Every record carries the pinned repository commit/tree and source document
blob/hash. Canonical serialization produces content-addressed chunks no larger
than 512 KiB plus lookup indexes and a schema-semver/content-version contract.
Migration aliases are accepted only when explicitly supplied by upstream;
ambiguous explicit aliases remain visible rather than being resolved fuzzily.

## Consequences

- UI, Worker, and Node importer runtimes are not dependencies of the model.
- Presentation fields expose sanitized structured/plain text and never raw
  HTML or executable links.
- KAN-32 is solely responsible for evaluation and roster legality.
- Until the upstream license is confirmed, source XML and real-derived domain
  payloads cannot be committed, bundled, or deployed.
