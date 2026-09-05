# Current task context

Scenario: Redis 缓存与并发控制
Stack: Redis 7, Node.js, TypeScript, Vitest

User request:

当前改动要求已经明确：订单缓存键统一使用 ord:v3: 前缀，结构变化时提升版本，不能复用旧前缀。 请仅在 `src/cache/order-cache.ts` 中落实这条已给出的要求。

The files in this directory are the complete environment snapshot available to the agent for this case.
