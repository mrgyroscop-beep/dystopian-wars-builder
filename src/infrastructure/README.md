# Infrastructure boundary

Adapters implement application ports for HTTP, local persistence and future
platform services. Composition roots inject these adapters into routes or the
Worker; domain code never imports them.
