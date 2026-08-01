# Dystopian Wars catalogue importer

This directory is a Node-only trust boundary. It downloads the ten `.gst`/`.cat`
files named in `source-lock.json`, verifies their bytes, parses them with a
streaming SAX parser, validates references and writes deterministic normalized
artifacts. Nothing here may be imported by `src` or `worker`.

## Commands

```text
npm run catalog -- fetch
npm run catalog -- build
npm run catalog -- import --expected=none
npm run catalog -- verify
npm run catalog -- rollback --release=<release-sha256> --expected=<current-sha256>
```

The defaults are `.cache/catalog` for verified source bytes and
`data/generated/runtime` for local releases. Both are ignored by Git. Override
them with `--cache=...`, `--runtime=...` or `--lock=...` in controlled jobs.

`import` never follows redirects and only fetches exact allowlisted paths from
the immutable commit in the lock. A network failure is an unsuccessful attempt;
it never silently promotes stale data. Use `build` explicitly when a previously
verified cache is intentionally required.

## Updating upstream

1. Review an exact upstream commit and its recursive Git tree.
2. Confirm the expected one `.gst` plus nine `.cat` inventory.
3. Calculate SHA-256 from the raw bytes and update every lock entry.
4. Run `npm run test:catalog`, then `npm run test:catalog:real` twice.
5. Review the manifest/inventory evidence and the upstream licensing decision.

Do not commit, package or deploy upstream XML or generated normalized artifacts
until the repository's redistribution license has been confirmed. CI enforces
this constraint. The lock contains only provenance and integrity metadata.
