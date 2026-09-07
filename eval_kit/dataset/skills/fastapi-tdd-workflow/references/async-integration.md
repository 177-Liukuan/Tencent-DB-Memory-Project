# Async integration checklist

- Reuse an injected `httpx.AsyncClient`.
- Set connect/read/write/pool timeouts explicitly.
- Propagate cancellation and map transport errors at the service boundary.
- Test timeout and upstream failure without mocking the service under test.
