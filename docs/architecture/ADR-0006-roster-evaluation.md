# ADR-0006: Pure roster cost and validation engine

## Status

Accepted for KAN-32.

## Decision

Roster evaluation is a single synchronous, deterministic domain operation:

```ts
evaluateRoster(catalog, roster): RosterEvaluation
```

`RosterSnapshot` is an immutable tree of selected instances. Every instance
uses stable instance, definition, placement, slot, parent, and force IDs and a
positive integer quantity. Catalogue definitions and shared placements remain
immutable.

The engine uses decimal strings backed by integer arithmetic. It never uses
floating-point arithmetic for Points, VP, modifiers, or constraint bounds.
Definition and placement-overlay costs are combined once per stable cost ID;
base and delta contributions remain visible. Limit costs do not enter totals.

Constraints support min/max (including exactly as equal min/max), selection and
category targets, and self/parent/force/roster/root-entry scopes. Conditions
support atLeast/atMost/equalTo/notEqualTo/instanceOf and nested and/or groups.
Numeric add/increment/decrement/multiply/set modifiers and repeat counts are
applied only when their conditions are true.

The result contains exact totals and contribution breakdowns, effective slot
cardinality, contextual option availability, and deterministic problems with an
exact roster instance plus entity/placement/slot target. Known violations are
`invalid`. Any missing, ambiguous, unsupported, or `evaluable:false` input is
`indeterminate`, so callers cannot display a false valid/available state.

## Consequences

- The engine imports no UI, application, infrastructure, browser, Worker, Node,
  or importer runtime.
- UI localization and presentation are separate consumer concerns.
- Persistence, roster creation flow, import, and cloud synchronization remain
  in KAN-33—37.
- Synthetic fixtures cover evaluator semantics. Pinned real integration checks
  Empire/Akita and a second faction without committing or publishing source
  XML or real-derived normalized payloads.
