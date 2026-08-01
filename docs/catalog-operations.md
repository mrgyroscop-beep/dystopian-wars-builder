# Catalogue operations

The stable consumer contract is `manifest.json` plus `catalog.json` in the
release selected by `current.json`. `manifest.json` records schema version,
content version, source commit/tree, per-file blob/SHA-256 and per-document
inventory. `operational.json` is deliberately outside that deterministic
contract and records only the latest attempt.

## Promotion safety

- pass `--expected=none` for the first publication;
- pass the observed current release ID for subsequent imports;
- never delete prior content-addressed releases before the replacement has been
  independently verified;
- on a bad release, use `rollback --release=<known-good> --expected=<current>`;
- treat `NETWORK_FAILURE`, integrity, XML, reference, lock and CAS errors as a
  failed update. Do not relabel them as a successful stale refresh.

The CLI emits one JSON diagnostic to stderr. Credential-like keys and signed URL
query values are redacted. Raw source payloads are not logged.

## Evidence

`npm run test:catalog:real` downloads the exact locked upstream bytes to a
temporary ignored directory, builds twice, proves byte equality, validates the
ten expected inventories, promotes and re-verifies the release, and writes
`artifacts/catalog-import-evidence.json` for CI review. The evidence includes
hashes and counts, never XML payloads.
