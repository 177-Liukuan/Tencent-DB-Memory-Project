# Current task context

Scenario: 消息队列与异步 Worker
Stack: Node.js, TypeScript, RabbitMQ, PostgreSQL

User request:

当前改动要求已经明确：账单事件主题固定为 billing.events.v2，生产者不得继续发送到 v1。 请仅在 `src/worker.ts` 中落实这条已给出的要求。

The files in this directory are the complete environment snapshot available to the agent for this case.
