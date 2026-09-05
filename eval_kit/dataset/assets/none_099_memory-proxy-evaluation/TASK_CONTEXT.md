# Current task context

Scenario: MemoryProxy 工具调用评测
Stack: TypeScript, Claude Code, TencentDB Agent Memory

User request:

只在 `src/recorder.ts` 中新增私有函数 `clamp_memory_proxy_evaluation(value, min, max)`；小于 min 返回 min，大于 max 返回 max，其余返回 value。

The files in this directory are the complete environment snapshot available to the agent for this case.
