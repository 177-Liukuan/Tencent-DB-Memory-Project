# Distributed lock

- Acquire with `SET key token NX PX ttl`.
- Release with a Lua compare-and-delete script.
- Keep the critical section shorter than the lease or renew deliberately.
- Define behavior when acquisition fails; do not spin without a bound.
