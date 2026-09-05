# Current task context

Scenario: PostgreSQL 数据库迁移
Stack: PostgreSQL 16, SQL, TypeScript, Vitest

User request:

只在 `src/order-repository.ts` 中新增私有函数 `clamp_postgres_migrations(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
