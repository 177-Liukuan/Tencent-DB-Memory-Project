# Current task context

Scenario: 可观测性与性能优化
Stack: Node.js, OpenTelemetry, Prometheus, k6

User request:

只在 `src/checkout.ts` 中新增私有函数 `clamp_observability_performance(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
