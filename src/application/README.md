# Application boundary

Use cases and ports live here. They may depend on `src/domain`, but not on React,
Hono, Cloudflare bindings or concrete infrastructure adapters. Zod is allowed
only where application data crosses a runtime boundary.
