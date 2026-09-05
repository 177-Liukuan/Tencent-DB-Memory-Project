# Current task context

Scenario: 消息队列与异步 Worker
Stack: Node.js, TypeScript, RabbitMQ, PostgreSQL

User request:

只在 `src/outbox.ts` 中新增私有函数 `clamp_message_queue_workers(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
