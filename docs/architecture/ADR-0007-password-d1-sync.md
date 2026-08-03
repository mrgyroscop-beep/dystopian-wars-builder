# ADR-0007: Email/password accounts and local-first D1 synchronization

- Status: accepted
- Jira: KAN-40, KAN-41
- Date: 2026-08-03

## Context

The builder needs optional accounts and cross-device roster storage without
making an internet connection mandatory. For a small project, familiar email
and password login is easier to explain and support than passkeys, OAuth or a
mail-based magic-link service.

Carnivale provides the baseline: same-origin API calls, user-scoped D1 rows, a
hashed session cookie, request throttling and local-first rosters. The builder
keeps its stricter optimistic conflict handling instead of last-write-wins.

## Decision

- Accounts use a normalized email and password. Passwords are derived with
  PBKDF2-HMAC-SHA256, a unique random salt and a stored work factor of 600,000.
- Login performs a password derivation even for an unknown email and returns
  the same error for an unknown account and an incorrect password.
- The browser receives an opaque `HttpOnly`, `Secure`, `SameSite=Strict`
  session cookie. D1 stores only its SHA-256 hash.
- Registration and login are rate-limited by hashed IP and, for login, hashed
  email. Passwords are accepted from 8 to 128 characters.
- Passkey endpoints, dependencies and tables are removed. The legacy
  `webauthn_user_id` column remains temporarily because rebuilding the parent
  users table would add migration risk without affecting behavior.
- Every roster query is scoped by the authenticated user id. Deleting an
  account explicitly removes its server-side sessions, credentials and rosters.
- Local storage remains the offline source of truth. Server writes require the
  last known version; conflicts preserve a separate local copy.
- D1 migrations are applied as a controlled step before the corresponding
  release. The normal direct-main workflow stays limited to build, deploy and
  one production smoke.

## Consequences

- Login is familiar and does not require an OAuth application or mail service.
- There is no automated password recovery in this small first version. An
  administrator must delete an inaccessible account until usage justifies a
  reset-email flow.
- Guests can continue to create and edit local rosters without signing in.
- Conflict handling favors preserving work over silently choosing a winner.
