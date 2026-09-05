# Current task context

Scenario: API 鉴权与安全
Stack: Node.js, TypeScript, JWT, PostgreSQL

User request:

当前改动要求已经明确：访问令牌固定使用 RS256，issuer 为 https://auth.example.internal，禁止接受 none 或 HS256。 请仅在 `src/auth.ts` 中落实这条已给出的要求。

The files in this directory are the complete environment snapshot available to the agent for this case.
