# Stampede protection

- Add TTL jitter.
- Use single-flight or a short rebuild lock.
- Serve bounded stale data only when the product allows it.
- Record rebuild latency and lock contention.
