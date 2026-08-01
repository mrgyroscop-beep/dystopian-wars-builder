# ADR-0002: Layered application boundaries

- Status: accepted
- Jira: KAN-29
- Date: 2026-08-01

## Context

Upcoming tasks introduce an external catalogue format, domain validation,
browser persistence and Cloudflare services. Letting framework and XML details
leak into the domain would make every layer difficult to test and replace.

## Decision

Use the following dependency direction:

```text
React UI/routes → application use cases/ports → pure domain
                         ↑
             infrastructure adapters
```

Composition roots (`src/app` and `worker`) select adapters and inject application
ports. Routes and reusable UI cannot import infrastructure adapters directly.
Runtime validation with Zod is restricted to external boundaries such as HTTP
payloads and route parameters. Domain code imports no React, browser, Hono,
Cloudflare, Node or XML APIs. `scripts/check-architecture.mjs` enforces the most
important seams.

## Consequences

- Domain tests run without a browser or Worker.
- Infrastructure can later provide local and D1 adapters behind the same ports.
- UI cannot bypass use cases to read future generated catalogue data directly.
- Some mapping code is explicit, which is preferred to implicit framework
  coupling.
