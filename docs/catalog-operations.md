# Catalogue operations

The stable consumer contract is `manifest.json` plus `catalog.json` in the
release selected by authoritative `lifecycle.json`. The deterministic manifest
records requested/resolved source commit/tree/timestamp, per-file
blob/size/SHA-256, importer/sanitizer contracts, licensing posture, content
diagnostic counts and per-document inventory. It contains no attempt clock.

Operational state is separate. One atomically replaced `lifecycle.json`
projection contains a `stable` pointer (active and last-known-good hashes) and a
`latest` pointer. Latest advances through `CHECKING`, `RESOLVED`, `PROMOTING`,
`SUCCESS` or `FAILURE` and distinguishes `UPDATE_AVAILABLE`, `STALE`, `SUCCESS`,
`UPDATE_FAILED_USING_LKG` and `UNAVAILABLE`. An operation ID prevents a
superseded concurrent check from overwriting the latest projection.

`operations/<opaque-id>.json` retains the latest safe snapshot per operation.
`diagnostics/<opaque-id>.json` contains only allowlisted code, severity, title,
reason, capability, action, retryability and active-release metadata. Raw error
messages/details, paths, source/internal IDs, XML and stacks are never serialized.

## Promotion safety

- pass `--expected=none` for the first publication;
- pass the observed current release ID for subsequent imports;
- never delete prior content-addressed releases before the replacement has been
  independently verified;
- on a bad release, use `rollback --release=<known-good> --expected=<current>`;
- treat `NETWORK_FAILURE`, integrity, XML, reference, lock and CAS errors as a
  failed update. Do not relabel them as a successful stale refresh.

Promotion updates the observable latest state without changing stable, writes
and verifies a content-addressed release, then atomically replaces both stable
and latest in `lifecycle.json` as its final fallible commit point. A failure
before that replacement cannot change active or last-known-good. No operation
after it may turn an active candidate into a reported failure.

The CLI emits the same allowlisted diagnostic projection to stderr. It never
echoes the underlying exception.

## Evidence

`npm run test:catalog:real` downloads the exact locked upstream bytes to a
temporary ignored directory, builds twice, proves byte equality, validates the
ten expected inventories, promotes and re-verifies the release, and writes
`artifacts/catalog-import-evidence.json` for CI review. The evidence includes
hashes and counts, never XML payloads.
