# Current task context

Scenario: Node.js / TypeScript API 服务
Stack: Node.js 22, TypeScript, pnpm, Vitest

User request:

只在 `src/http/order-client.ts` 中新增私有函数 `clamp_node_typescript_api(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
