# Catalogue operations

The stable consumer contract is `manifest.json` plus `catalog.json` in the
release selected by authoritative `lifecycle.json`. The deterministic manifest
records requested/resolved source commit/tree/timestamp, per-file
blob/size/SHA-256, importer/sanitizer contracts, licensing posture, content
diagnostic counts and per-document inventory. It contains no attempt clock.

Operational state is separate: immutable `operations/<opaque-id>.json` records
`RESOLVED` or `FAILED` attempts, while redacted details live under
`diagnostics/<opaque-id>.json`. Lifecycle and operation records expose requested,
resolved, active and last-known-good release hashes; consumers do not parse
diagnostic text to determine state.

## Promotion safety

- pass `--expected=none` for the first publication;
- pass the observed current release ID for subsequent imports;
- never delete prior content-addressed releases before the replacement has been
  independently verified;
- on a bad release, use `rollback --release=<known-good> --expected=<current>`;
- treat `NETWORK_FAILURE`, integrity, XML, reference, lock and CAS errors as a
  failed update. Do not relabel them as a successful stale refresh.

Promotion writes and verifies a content-addressed release, records the resolved
operation, then atomically replaces `lifecycle.json` as its final fallible commit
point. A failure before that replacement cannot change active or
last-known-good. No operation after it may turn an active candidate into a
reported failure.

The CLI emits one JSON diagnostic to stderr. Credential-like keys and signed URL
query values are redacted. Raw source payloads are not logged.

## Evidence

`npm run test:catalog:real` downloads the exact locked upstream bytes to a
temporary ignored directory, builds twice, proves byte equality, validates the
ten expected inventories, promotes and re-verifies the release, and writes
`artifacts/catalog-import-evidence.json` for CI review. The evidence includes
hashes and counts, never XML payloads.
