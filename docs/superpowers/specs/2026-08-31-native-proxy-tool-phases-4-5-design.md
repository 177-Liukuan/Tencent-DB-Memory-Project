# Native Proxy Tool 阶段四、五设计

> 日期：2026-08-31  
> 状态：依据已完成导师对齐的内部实施方案执行  
> 实现目录：`TencentDB-Agent-Memory-Native/MemoryProxy`  
> 前置提交：阶段二、三 `787cbb4`

## 1. 范围

本轮完成阶段四和阶段五中尚未落地的工程内容：

1. 注册并执行 6 个 Memory Native Proxy Tool；
2. 注册并执行 10 个 Skill Native Proxy Tool；
3. 复用 Memory Bridge 与 Skill Bridge，不复制身份、ACL 或后端业务逻辑；
4. 扩展 OpenAI-compatible Chat Completions 流式 Tool Loop；
5. 对 Provider Server Tool/opaque 协议块做无损透传；
6. 在 Context Compression 前恢复隐藏工具历史，压缩成功后建立 Checkpoint 并使旧状态失效。

明确排除：

- Knowledge Native Proxy Tool；
- OpenAI Responses Adapter；
- Baseline Fake Tool、curl 指南或关闭 Native Tool 后的 Fake Tool 回退；
- MemoryCore/Skill Core 业务重写；
- 与隐藏 Tool 历史无关的通用压缩算法改造。

## 2. 实施顺序

采用“执行边界优先”的顺序，而不是机械按阶段编号推进：

1. 泛化 Tool Definition、Exposure Resolver 和 Dispatcher；
2. 注册全部 Memory/Skill Tool 并完成 Bridge 契约；
3. 在已稳定的统一模型上增加 OpenAI-compatible Adapter；
4. 最后增加依赖持久化完整性的 Compression Checkpoint。

这样可让 Anthropic 和 OpenAI 共用完全相同的 Registry、租约、调用限制、结果归并和恢复逻辑。

## 3. Tool Registry 与暴露策略

### 3.1 Memory Tool

| 工具 | Bridge route | 副作用 |
| --- | --- | --- |
| `tdai_memory_search` | `atomic/search` | read |
| `tdai_atomic_query` | `atomic/query` | read |
| `tdai_conversation_search` | `conversation/search` | read |
| `tdai_conversation_query` | `conversation/query` | read |
| `tdai_scenario_ls` | `scenario/ls` | read |
| `tdai_read_scene` | `scenario/read` | read |

仅当 Session 身份可信、TDAI Memory 启用且 `assetCapabilities.chat_memory !== false` 时暴露。模型不能传 URL、Header、鉴权、租户、用户或最终执行身份。`agent_id` 如业务兼容必须接收，也只能作为授权资产引用，由 Bridge 重新校验。

### 3.2 Skill Tool

完整 Registry 包含：

- 常规暴露：`skill_search`、`skill_view`、`skill_files_read`、`skill_extract`；
- 仅 `skillRuntime.allowLlmWrite=true`：`skill_create`、`skill_update`、`skill_patch`、`skill_delete`、`skill_files_write`、`skill_files_remove`。

`assetCapabilities.skill=false` 时不暴露任何 Skill Tool。`skill_extract` 标记为 `archive`；其余修改操作标记为 `write`。Skill 目录继续是动态上下文，不复制进 Tool Schema。

### 3.3 定义结构

`NativeProxyToolDefinition` 从固定 Memory route 泛化为：

```ts
interface NativeProxyToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  owner: "proxy";
  backend: "memory" | "skill";
  effect: "read" | "write" | "archive";
  route: string;
  exposure: "memory" | "skill-read" | "skill-write";
  validate(input: unknown): ValidationResult;
}
```

Registry 是 Schema、工具名、路由、副作用和暴露类别的单一事实来源。未知字段全部拒绝；字符串、数组、分页、枚举和内容大小均设明确上限。

## 4. Dispatcher 与 Bridge

Dispatcher 通过 executor map 按 `backend` 分发，不再硬编码 Memory Bridge。统一执行步骤为：

1. Registry ownership 与当前请求 exposure 二次校验；
2. Schema 校验；
3. 从可信 Session 形成 Bridge scope；
4. 以每个 Tool Definition 的超时/重试策略调用进程内 Bridge executor；
5. 将 HTTP/业务 envelope 映射为稳定 Tool Result；
6. 对结果执行 UTF-8 安全截断并标记 `truncated=true`。

只对网络错误、408、429 和 5xx 做有限重试；参数、权限、404、版本冲突及其他业务 4xx 不自动重试。全局 `maxRounds/maxCallsPerRound/maxTotalCalls` 仍由 Coordinator 强制执行。

Memory Bridge 继续覆盖身份并限制在只读 allowlist。Skill Bridge 继续负责身份、团队可见性、Owner ACL 和版本固定；`skill_delete` 纳入 `expected_version` 自动注入。文件读取只返回受限文本/base64 或省略标记，不写客户端工作区。

只读工具可在协议完成信号后提前执行。`write/archive` 工具必须等本轮流完整后才执行；状态租约和 `call_id` 阻止 Proxy 内并发重复执行。Bridge/Core 返回版本冲突时形成可恢复 Tool Result，不盲目重放副作用。

## 5. OpenAI-compatible Chat Completions

在现有 `OpenAIAdapter` 上增加增量 SSE parser，不建立第二套 Tool Loop：

- 累积 `choices[0].delta.tool_calls[index]` 的 `id/type/function.name/function.arguments`；
- 没有单调用完成信号时，仅在明确轮末 `finish_reason=tool_calls` 或 `[DONE]` 后产生 `tool_call_completed`；
- 原始 SSE frame、usage、content、reasoning_content 和未知扩展字段均保存；
- Registry-owned function call 归 proxy，其他标准 function call 归 client；
- 纯 Client 响应原字节回放，纯 Native 内部重入，混合调用按 `call_id` 和原始 index 恢复；
- 重入消息使用 OpenAI `assistant.tool_calls[]` 与逐条 `role=tool/tool_call_id`；
- 非流式 Chat Completions 首版不注入 Native Tool，避免出现未实现闭环。

`handler.ts` 的成功流由 Coordinator 唯一消费；原有 usage、L0、Skill extraction、Langfuse 和 credit 观测通过完成回调保留。OpenAI Responses 路由保持原行为且不接入 Native Tool Runtime。

## 6. Provider Tool 与 opaque block

只有 Registry 明确认领的函数/tool call 才进入 Proxy 槽位；标准客户端函数进入 Client 槽位。其余 Provider 扩展字段或非 function 协议块视为 opaque：

- 不建立 ToolCallSlot；
- 不执行、不改名、不解析参数；
- 在纯 Client/无工具响应中保持原始字节；
- 在需要重建的响应中保留原始协议字段、顺序和状态。

Native 名称泄漏扫描只针对 Registry 保留名和对应 call ID，不能误删 Provider 数据。

## 7. Context Compression

### 7.1 状态语义

ToolExecutionContext 增加逻辑 checkpoint 字段：

```ts
interface CompressionCheckpoint {
  version: string;
  coveredThroughTurnSeq: number;
  createdAt: string;
}

interface ToolExecutionContext {
  // existing fields
  coveredByCheckpoint?: CompressionCheckpoint;
}
```

Storage Adapter 增加：

- 按可信 Session、协议、当前 context version 和 turn 范围读取已完成隐藏历史；
- CAS 标记 `coveredByCheckpoint`；
- 查询时默认排除已覆盖记录；
- pending/running/aborted、范围外及身份不匹配记录不得被覆盖。

### 7.2 压缩流程

识别到 OpenAI-compatible compaction 辅助请求时：

1. 在任何压缩模型调用之前读取尚未覆盖的已完成 Native 批次；
2. 使用同一消息骨架和槽位重建逻辑历史；
3. 按 `turnSeq` 插入客户端历史对应位置，避免重复 call/result；
4. 将完整逻辑历史发送给现有压缩上游；
5. 仅在上游成功且返回有效压缩结果后生成新 `context_version` checkpoint；
6. CAS 标记本次覆盖范围，后续主请求使用新版本；
7. 压缩失败时不标记、不丢状态。

客户端重复提交压缩请求时，以请求指纹和 checkpoint version 幂等处理。同一隐藏批次不会被重复注入新上下文。

## 8. 测试与验收

测试采用 TDD，并覆盖：

- 6 个 Memory、10 个 Skill Schema 与 0/4/10 exposure；
- 纯 Native、纯 Client、混合、同名多调用和乱序完成；
- 参数缺失、未知字段、Bridge 4xx/5xx/429、超时、有限重试、空结果与截断；
- Skill visibility、写开关、版本固定、delete 版本锁和 archive 延迟执行；
- OpenAI 参数分片、多 tool_calls、轮末完成、reasoning/unknown/provider 字段无损；
- Provider 数据不进入 Proxy/Client 槽位；
- Compression 重建、成功覆盖、失败不覆盖、pending 保留、重复 checkpoint、重启恢复和 TTL；
- Anthropic 回归、Native 零泄漏、TypeScript、真实 ClickHouse 集成。

完成标准是 Anthropic 与 OpenAI-compatible Chat Completions 共用一个可靠 Tool Loop；Memory/Skill 全部以结构化 Native Proxy Tool 提供；Knowledge 和 Responses 不被意外注入或执行。
