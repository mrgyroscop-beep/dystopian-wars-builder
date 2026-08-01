# Dystopian Wars Builder

Private application repository for a Dystopian Wars 4.0 fleet builder. The
product will let players assemble, validate, save and review fleets using the
current game data.

## Repository status

The repository is in **bootstrap mode** while the application scaffold is built
in `KAN-29`. Bootstrap mode intentionally contains no product UI or runtime
application code. It establishes a protected, reviewable delivery path first.

Reference PDF and STL files may be kept beside the checkout for research. They
are ignored by Git and must never be committed or uploaded to the repository.

## Development workflow

1. Start from an up-to-date `main` branch.
2. Create a Jira-linked branch named `codex/KAN-XX-short-description`.
3. Commit changes with the Jira key in every commit subject.
4. Open a pull request and complete the repository template.
5. Wait for `Required CI` and an independent approval before merging.

Direct work on `main`, force-pushes and merge commits are not part of the
supported process. See [CONTRIBUTING.md](CONTRIBUTING.md) for the complete
conventions.

## Continuous integration

The `Required CI` job has a stable name so it can be required by branch
protection.

- Without `package.json`, it validates repository governance and reports
  **bootstrap mode**.
- Once `KAN-29` adds the application, it additionally runs `npm ci`, `build`,
  `lint`, unit tests and the E2E smoke test through documented package scripts.

Run the bootstrap validation locally from PowerShell 7:

```powershell
pwsh -File scripts/validate-bootstrap.ps1
```

## Release and rollback

Releases must be traceable to an immutable commit on `main`; recovery uses a
reviewed revert rather than rewriting history. The operational checklist is in
[docs/release-and-rollback.md](docs/release-and-rollback.md).
