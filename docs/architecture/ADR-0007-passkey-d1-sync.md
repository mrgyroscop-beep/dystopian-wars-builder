# ADR-0007: Passkey accounts and local-first D1 synchronization

- Status: accepted
- Jira: KAN-40, KAN-41
- Date: 2026-08-03

## Context

The builder needs optional accounts and cross-device roster storage without
making an internet connection mandatory. The project is small, so operating a
mail delivery service, password recovery or an OAuth application would add more
infrastructure than the feature needs.

Carnivale provided the useful baseline: same-origin API calls, user-scoped D1
rows, a hashed session cookie, request throttling and local-first rosters. Its
password and last-write-wins choices are deliberately not copied because they
would require account recovery and could silently overwrite concurrent edits.

## Decision

- Accounts use WebAuthn passkeys. Registration and login challenges are
  short-lived, rate-limited and consumed once.
- The browser receives an opaque `HttpOnly`, `Secure`, `SameSite=Strict`
  session cookie. D1 stores only its SHA-256 hash.
- Every roster query is scoped by the authenticated user id. Deleting an
  account explicitly removes its server-side sessions, passkeys and rosters.
- Local storage remains the offline source of truth. Mutations are queued and
  retried after connectivity returns.
- Server writes require the last known roster version. A version mismatch
  returns a conflict instead of overwriting data; the client keeps the local
  edit as a separate copy and adopts the current server version.
- D1 migrations run immediately before the Worker deploy. The production D1
  resource and binding are created only through the controlled infrastructure
  change.

## Consequences

- No password, email provider, OAuth secret or recovery flow is required.
- A synced passkey or cross-device passkey flow is needed to enter the account
  on another device. Losing every passkey means losing server-account access;
  adding recovery is a separate feature if real usage justifies it.
- Guests can continue to create and edit local rosters without signing in.
- Conflict handling favors preserving work over silently choosing a winner.
