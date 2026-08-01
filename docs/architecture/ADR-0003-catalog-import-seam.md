# ADR-0003: Node-only catalogue import seam

- Status: accepted
- Jira: KAN-29
- Date: 2026-08-01

## Context

The source repository publishes BattleScribe `.gst` and `.cat` XML. Parsing and
normalisation require filesystem/network tooling that does not belong in the
browser or request-time Worker path.

## Decision

KAN-30 will implement the importer under `scripts/catalog`. It will run in Node,
validate external input at runtime and write a versioned normalised artifact to
`data/generated`. Browser and Worker modules may consume only the generated
contract through future infrastructure adapters; they must never import the
importer or parse XML.

The scaffold contains no downloader, XML parser, catalogue copy or game entity.
`scripts/check-architecture.mjs` rejects imports of this seam from `src` or
`worker`.

## Consequences

- Import failures happen during a controlled update job, not user requests.
- Generated data can be reviewed, cached and versioned independently.
- KAN-30 must define provenance, integrity, migration and update behavior before
  any catalogue is committed or deployed.
