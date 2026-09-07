---
name: message-worker-reliability
description: >
  Use when building or changing message consumers, retries, dead-letter queues, outbox delivery, replay tools, ordering guarantees, schema evolution, or backpressure. The skill treats at-least-once delivery and partial failure as normal.
license: MIT
metadata:
  author: benchmark-dataset-generator
  version: "1.0"
  domain: coding
  scenario: message-queue-workers
---

# Message Worker Reliability

## When to Use

- Implementing an idempotent consumer
- Adding retry and DLQ behavior
- Building an outbox or replay path
- Changing event schemas or ordering

## Core Workflow

1. Define delivery and ordering assumptions.
2. Choose an idempotency key and durable state.
3. Make acknowledgement follow durable completion.
4. Bound retry and route poison messages.
5. Add metrics, replay controls, and concurrency tests.

## Reference Files

| Topic | File | Load when |
|---|---|---|
| Idempotent Consumer | `references/idempotent-consumer.md` | Read when the task directly involves this topic |
| Retry Dlq | `references/retry-dlq.md` | Read when the task directly involves this topic |

## Constraints

### MUST DO

- Assume duplicate delivery.
- Persist idempotency before acknowledging.
- Make replay observable and bounded.

### MUST NOT DO

- Assume exactly-once delivery.
- Ack before durable completion.
- Retry poison messages forever.

## Output

Return the changed files or proposed patch, the verification performed, and any remaining risk. Keep unrelated changes out of the final diff.
