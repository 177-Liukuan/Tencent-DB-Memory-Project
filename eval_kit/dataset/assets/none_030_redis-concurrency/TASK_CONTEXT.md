# Current task context

Scenario: Redis 缓存与并发控制
Stack: Redis 7, Node.js, TypeScript, Vitest

User request:

只在 `src/lock.ts` 中新增私有函数 `clamp_redis_concurrency(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
