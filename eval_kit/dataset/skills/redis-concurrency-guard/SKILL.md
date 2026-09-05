---
name: redis-concurrency-guard
description: >
  Use when implementing distributed locks, cache stampede protection, rate limiting, Lua-based atomic operations, negative caching, or Redis Cluster key design. The skill emphasizes ownership, expiry, bounded load, and failure recovery.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: redis-concurrency
---

# Redis Concurrency Guard

## When to Use

- Implementing distributed locks
- Preventing cache stampedes
- Building atomic counters or rate limits
- Designing cache keys for Redis Cluster

## Core Workflow

1. Define correctness and failure modes.
2. Choose atomic Redis primitives or Lua.
3. Bound TTLs and retries.
4. Add observability and fallback behavior.
5. Test ownership, expiry, contention, and failure.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Distributed Lock | `references/distributed-lock.md` | Read when the task directly involves this topic |
| Stampede | `references/stampede.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Use unique lock tokens.
- Set expirations on temporary keys.
- Test concurrent contenders.

### MUST NOT DO

- Delete a lock without verifying ownership.
- Use KEYS in production code.
- Treat cache as the source of truth.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
