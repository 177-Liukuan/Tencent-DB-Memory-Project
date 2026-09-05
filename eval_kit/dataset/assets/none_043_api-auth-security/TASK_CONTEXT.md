# Current task context

Scenario: API 鉴权与安全
Stack: Node.js, TypeScript, JWT, PostgreSQL

User request:

只在 `src/routes/login.ts` 中新增私有函数 `clamp_api_auth_security(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
