# ADR-0004: Deterministic catalogue ingestion and promotion

- Status: amended
- Jira: KAN-30
- Date: 2026-08-01

## Context

The application depends on community-maintained BattleScribe/New Recruit XML.
Mutable branch URLs, permissive XML processing and in-place updates could make a
build irreproducible, expose local/network resources or replace working data
with a partial update. The upstream repository currently has no confirmed
redistribution licence in scope for this project.

## Decision

- Pin a full commit, commit timestamp, tree, Git blob, byte size and SHA-256 for
  an exact ten-file allowlist; verify commit/tree/blob provenance through the
  immutable GitHub API before accepting raw bytes.
- Fetch only immutable raw GitHub paths with redirects disabled, byte/time
  limits, a content-verified cache and redacted diagnostics.
- Parse in Node with `saxes`. Reject DTD/entity declarations, processing
  instructions, XInclude-like input and configured structural limits. Normalize
  all attribute and text values to Unicode NFC before artifact construction.
- Preserve duplicate IDs in deterministic document scope. A `targetId` resolves
  first within its document and then uniquely across the complete source set;
  unresolved or ambiguous references fail the whole build.
- Validate catalogue/category/entry/info links against their exact target node
  kinds after deterministic resolution.
- Represent description/comment content as a safe rich-text AST supporting
  paragraphs, strong text, line breaks and tables. Emit deterministic plain
  fallback plus meaningful-loss/content-unavailable diagnostics. Raw HTML is
  never emitted.
- Canonicalize keys and source order. The artifact manifest has no clock field;
  its SHA-256 is the release ID. Attempt time and outcome live only in the
  operational record.
- Publish to a content-addressed staging directory, verify it, rename it, record
  observable checking/resolved/promoting state and atomically replace
  authoritative `lifecycle.json` as the final fallible commit point under a lock
  and compare-and-swap guard. The projection contains stable active/LKG and the
  latest operation/status; operation IDs prevent stale concurrent writers.
  Operational diagnostics use a strict allowlist and an opaque ID, never raw
  exception content. Older releases remain available for rollback.
- Keep importer dependencies out of browser and Worker bundles. Do not commit raw
  upstream data. On 2026-08-03 the project owner confirmed redistribution rights
  for the generated catalogue; build-time publication of verified, normalized,
  content-addressed chunks is therefore permitted. The source XML remains outside
  Git and deployment artifacts.

## Consequences

An upstream update is explicit and reviewable. A corrupt file, broken reference,
network failure or failed staging verification leaves the last-known-good
pointer unchanged. Consumers can report `source.commit`, `contentVersion` and
catalog revisions without coupling to the ingestion runtime.
