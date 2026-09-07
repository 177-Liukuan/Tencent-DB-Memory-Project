# Anthropic Native Proxy Tool 阶段二、三设计

> 日期：2026-08-31  
> 状态：已由用户确认架构与可靠性设计，待书面规格复核  
> 实现目录：`TencentDB-Agent-Memory-Native/MemoryProxy`  
> 依据：`Native Tool课题目标与技术实施方案（内部）.md` 的阶段二、三，以及 `Native Proxy Tool适配参考/`

## 1. 目标与范围

本轮实现 Anthropic Messages 流式链路下的 Native Proxy Tool 最小可靠闭环，并完成 Client Tool 轮末下发、混合工具归并和 ClickHouse 状态持久化。

交付范围如下：

1. 建立统一 Tool Registry，首期只注册只读工具 `tdai_memory_search`；
2. 扩展现有 Anthropic Adapter，增量解析 SSE Content Block，并且只在对应 `content_block_stop` 后产生 `tool_call_completed`；
3. 让 MemoryProxy 成为成功上游 SSE 的唯一消费者；
4. Native Tool 参数完整后立即可靠落盘、认领执行租约并通过进程内 Memory Bridge 执行；
5. Client Tool 收集至 `message_stop` 后再下发；
6. 支持纯 Native、纯 Client 和 Native/Client 混合响应；
7. 使用消息骨架、有序槽位和 `call_id` 恢复模型生成顺序；
8. 实现 ClickHouse `ToolExecutionStorageAdapter`，持久化流快照、执行租约、Client 下发状态、结果、revision 和 TTL；
9. 支持 Client 结果先到、Native 结果后到，以及服务重启后的只读工具恢复；
10. 从 Native 项目移除 Fake Tool 文本注入和 curl 指南，关闭 Native Tool 时不回退到 Fake Tool。

本轮明确不实现：

- Skill、Knowledge 的 Native Tool Schema 和执行器；
- 其余五个 Memory Native Tool；
- OpenAI-compatible Tool Loop；
- OpenAI Responses；
- Context Compression 历史补全和 checkpoint；
- 写入型 Native Tool；
- Native Tool 的非流式 Anthropic 闭环；
- 新的外部队列、微服务或通用存储框架。

非流式 Anthropic 请求不会注入 `tdai_memory_search`，避免模型产生当前版本无法闭环处理的 Native Tool Call。

## 2. 方案选择

### 2.1 采用方案

采用“协议事件驱动的独立编排器”方案：

- Anthropic Adapter 负责协议解析与重建；
- Tool Registry 负责稳定工具定义、归属和执行元数据；
- Tool Loop Coordinator 只处理统一事件、槽位和状态转换；
- Dispatcher 负责校验、执行和错误归一化；
- Storage Adapter 隔离 ClickHouse 细节；
- `anthropicHandler.ts` 保留现有鉴权、Session Init、注入、路由和观测职责，只在转发边界接入编排器。

该方案比直接把逻辑写入现有大型 Handler 更易测试，也能在后续复用同一 Coordinator 扩展 OpenAI-compatible 协议。

### 2.2 未采用方案

1. **Handler 内联状态机**：新增文件较少，但协议解析、Client 恢复、租约、观测和路由会继续耦合在 2000 行以上的 Handler 中，阶段三的并发测试和恢复测试难以隔离。
2. **独立 Tool Loop 服务或队列**：隔离性强，但新增部署单元和一致性系统，超出课题当前最小闭环。
3. **Redis/Keeper 租约回退**：能提供成熟的 OLTP/CAS 语义，但违背本轮 ClickHouse Adapter 的既定目标。本设计要求 ClickHouse 能力不可用时 fail-closed，不做静默回退。

## 3. 总体架构

```text
Claude Code
    |
    v
anthropicHandler
    |  auth / session init / injection / routing / request preparation
    v
Anthropic upstream
    |
    v  one successful SSE body, one consumer
Anthropic incremental parser
    |
    +-- block / usage / message events
    +-- tool_call_completed only after content_block_stop
    v
Tool Loop Coordinator
    |                  |                    |
    |                  |                    +--> client-visible SSE rebuilder
    |                  +--> ToolExecutionStateStore
    |                           |
    |                           +--> ClickHouse storage adapter
    v
Native Proxy Tool Dispatcher
    |
    v
in-process Memory Bridge --> MemoryCore
    |
    v
slot result --> full message reconstruction --> exact-target internal re-entry
```

组件保持窄接口：Adapter 不执行工具，Dispatcher 不解析 SSE，Storage Adapter 不理解 Anthropic wire format，Handler 不手工拼接 Tool Call。

## 4. Tool Registry 与注入

### 4.1 首期工具

稳定注册名为 `tdai_memory_search`：

```json
{
  "name": "tdai_memory_search",
  "description": "搜索已经提炼的长期记忆，用于查找当前上下文之外的用户偏好、身份事实、历史结论、规则和项目约定。过去消息的具体原文或时间线不属于本工具范围。",
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "query": {
        "type": "string",
        "minLength": 1,
        "maxLength": 2000,
        "description": "需要检索的问题或关键词"
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 20,
        "default": 5
      }
    },
    "required": ["query"]
  }
}
```

Registry 的内部定义额外包含：

- `owner: "proxy"`；
- `effect: "read"`；
- Bridge route `atomic/search`；
- 参数校验器；
- 执行超时和结果大小上限；
- Result Mapper。

URL、Header、鉴权、`space_id`、`user_id`、`team_id`、最终 `agent_id` 不进入 Tool Schema。

### 4.2 暴露条件

同时满足以下条件才向 Anthropic `tools[]` 追加该工具：

- `nativeProxyTools.enabled=true`；
- 请求为 Anthropic streaming；
- 请求属于可注入的主链路；
- Session 已初始化并有可信身份；
- TDAI Memory 已启用；
- 当前用户的 `chat_memory` capability 未显式关闭。

如果客户端已经提供同名工具，请求在转发前以明确的命名冲突错误失败，不能覆盖客户端定义，也不能静默跳过 Native Tool。

### 4.3 Fake Tool 移除

Native 项目执行以下收敛：

- 删除 `SkillToolsInjector` 和 `TdaiToolsInjector` 的注册及源文件；
- `TdaiProfileMemoryInjector` 移除 `<memory-tools-guide>`；
- Knowledge curl 型 Injector 停止注册并从 Native 项目移除；
- `SkillInjector` 只允许保留不引用 curl/Fake Tool 的资产目录职责；在 Skill Native Tool 尚未实现时，不注入会诱导模型调用不存在工具的说明；
- 删除 `injection.externalGatewayUrl` 这类仅服务于模型生成 Bridge curl 的配置；
- 更新 README、中文 README、配置示例和源码注释，不再指导模型或用户以 Fake Tool 方式调用；
- Bridge HTTP 路由可以保留作为内部业务边界，但不会作为模型可见回退路径。

`nativeProxyTools.enabled=false` 的含义仅是“不注入和执行 Native Proxy Tool”。它不会重新注册任何 Fake Tool Injector。

## 5. Anthropic 增量协议模型

### 5.1 Adapter 扩展

现有 `ProtocolAdapter` 保留请求 `parse/serialize`，增加流式解析器工厂。Anthropic Parser 接收原始字节并负责标准 SSE framing，包括：

- 跨 chunk 的 UTF-8 与事件边界；
- `event:`、多行 `data:`、空行和 CRLF；
- malformed event 的明确错误；
- 原始 frame 保存，用于纯 Client 无损回放和混合响应过滤。

统一事件至少包括：

```ts
type ProtocolStreamEvent =
  | { type: "message_started"; message: JsonValue }
  | { type: "content_block_started"; index: number; block: JsonValue }
  | { type: "content_block_delta"; index: number; delta: JsonValue }
  | { type: "content_block_completed"; index: number; block: JsonValue }
  | { type: "tool_call_completed"; call: UnifiedToolCall }
  | { type: "usage_updated"; usage: JsonValue }
  | { type: "message_completed"; stopReason?: string }
  | { type: "protocol_error"; code: string; message: string };
```

### 5.2 Tool Call 完整边界

Anthropic `tool_use` 的处理顺序固定为：

1. `content_block_start` 保存 `id`、`name`、Block index；
2. 多个 `input_json_delta` 按原顺序累积字符串；
3. `content_block_stop` 到达；
4. 此时才解析完整 JSON、校验结构并产生 `tool_call_completed`。

中间字符串即使已经可以 `JSON.parse`，也不能提前产生完成事件。

### 5.3 Block 保真

Parser 的 Assistant Skeleton 保留：

- text；
- thinking 与 signature；
- client `tool_use`；
- Native `tool_use`；
- Provider Server Tool 相关未知 Block；
- 每个 Block 的协议原生字段和原始 `content_block_index`。

未知非 `tool_use` Block 默认归为 Provider/opaque block，保留而不执行。只有 Registry 明确认领的名称才是 Native Proxy Tool；其他标准 `tool_use` 默认为 Client Tool。

## 6. 流式状态机

### 6.1 唯一消费

成功的上游 SSE 不再调用 `ReadableStream.tee()`。Coordinator 顺序读取一次上游流，同时：

- 缓存原始字节；
- 将字节送入 Adapter Parser；
- 更新消息骨架和槽位；
- 在 Native `tool_call_completed` 时启动可靠执行；
- 在终止时裁决客户端可见响应。

上游 4xx/5xx 响应也由 Proxy 读取一次后重建响应，不再通过 `tee()` 分支读取。

### 6.2 槽位

每个 Tool Call 建立槽位：

```ts
interface ToolCallSlot {
  callId: string;
  slotIndex: number;
  contentBlockIndex: number;
  toolName: string;
  owner: "proxy" | "client";
  input?: JsonValue;
  argumentsComplete: boolean;
  status: "collecting" | "pending" | "running" | "succeeded" | "failed";
  executionAttempt: number;
  executionLeaseOwner?: string;
  executionLeaseUntil?: string;
  result?: JsonValue;
  isError?: boolean;
}
```

`slotIndex` 按 Tool Call 的模型生成顺序递增。结果只按 `call_id` 定位，最终恢复按 `slotIndex/contentBlockIndex` 排序，不按工具名或完成时刻拼接。

### 6.3 Native Tool 提前执行

收到 Native `tool_call_completed` 时：

1. 如果这是批次内第一个 Native Tool，创建持久化上下文，同时补入此前已经完整的 Client 槽位；
2. 可靠保存最新 skeleton、slots 和 streaming 状态；
3. 原子认领该槽位执行租约；
4. 认领成功的实例立即调用 Dispatcher；
5. Dispatcher 完成后 CAS 写入成功或结构化错误结果；
6. SSE 读取继续进行，不等待工具执行完成。

只有 Client Tool 的响应不创建隐藏批次状态，避免改变客户端原生 Tool Loop 的后续请求语义。

### 6.4 `message_stop` 裁决

收到 `message_stop` 后分为四类：

1. **无 Tool Call**：回放原始完整 SSE；
2. **纯 Client Tool**：回放原始完整 SSE，由 Claude Code 执行；
3. **纯 Native Tool**：等待所有 Native 槽位终态，重建完整消息并 Internal Re-entry，当前响应对客户端不可见；
4. **混合 Tool Call**：不等待 Native 执行完成；持久化 Client dispatch 状态后，过滤 Native Tool 的全部 start/delta/stop frame，重新映射剩余 Block index，向 Claude Code 下发 Client Tool。

纯 Client 和无 Tool Call 路径保存并回放原始 SSE 字节。只有现有 thinking 兼容修复确实需要修改非法字段时，允许进行与旧实现等价的最小修补。

### 6.5 SSE 中断

只有 `message_stop` 才表示本轮响应完整。若 EOF、读取异常、超时或协议错误发生在它之前：

- 已创建的批次标记 `responseStreamStatus="aborted"`；
- 不使用不完整 assistant skeleton 重入；
- 不向客户端泄漏已产生的 Native Tool frame；
- 已开始的只读执行可以完成并落结果，但批次不会被重入，随后由 TTL 回收；
- 因为尚未向客户端发送上游字节，Proxy 可以返回明确的 Anthropic/HTTP 错误。

## 7. Client 可见响应与完整消息恢复

### 7.1 混合响应过滤

Client-visible SSE Rebuilder 基于已解析事件而不是字符串搜索：

- 删除 owner 为 `proxy` 的 `tool_use` Block 的完整事件生命周期；
- 保留 text、thinking/signature、Client Tool 和 Provider Block；
- 将可见 Block index 重排为连续值；
- 保留 message id、model、usage、stop reason 和其他顶层元数据；
- 扫描重建后的字节，确保 Native 工具名、Native `call_id` 和 Native 输入没有出现。

### 7.2 Client Result 处理

后续 Claude Code 请求中的 `tool_result.tool_use_id` 用于定位状态：

1. 在可信的 space/user/agent/session scope 内查找活跃批次；
2. 同一请求的已知 call ID 必须属于同一个批次；
3. 已知批次中混入未知 call ID 时拒绝请求；
4. 同一个 Client Result 重复提交时返回明确冲突，不覆盖旧结果；
5. Client Result 成功 CAS 入槽后，等待 Native 槽位终态；
6. Native 租约尚未过期时只等待，不能盲目重复执行；
7. 租约已过期或槽位仍为 pending 时，可以按相同 `call_id` 重新认领只读执行；
8. 全部槽位终态后恢复完整 assistant 消息和完整 Tool Result 消息，然后重入。

如果请求中的 Tool Result 没有命中任何 Native 混合批次，则保持普通 Client Tool Result 请求的既有转发行为。

### 7.3 完整历史形态

重入时追加：

```text
首次上游请求的 messages
  + 原始完整 assistant content blocks
  + 按原 Tool Call 顺序排列的一一对应 tool_result blocks
```

即使实际完成顺序为 `P1 -> P2 -> C2 -> C1`，恢复顺序仍是模型生成的 `P1 -> C1 -> C2 -> P2`。

## 8. Dispatcher 与 Memory Bridge

### 8.1 进程内 Bridge 接口

将现有 `memory-bridge.ts` 拆成：

- 协议无关的 `executeMemoryBridge(input, context, deps)`；
- 薄的 Hono HTTP Handler，负责从 Request 解析 path/header/body 后调用该接口；
- Native Dispatcher 直接调用同一接口。

这样复用现有身份恢复、固定资产解析、多 Agent search、权限、上游鉴权、业务路由和 telemetry，不进行本机 HTTP 回环，也不复制 MemoryCore 逻辑。

### 8.2 校验与错误映射

Dispatcher 按顺序执行：

1. Registry name lookup；
2. 完整 JSON 参数校验；
3. 移除模型不能提供的身份/URL/Header 字段；
4. 从可信 Session 补充 identity；
5. 受超时约束地调用 `atomic/search`；
6. 将 HTTP/业务信封映射为稳定结果；
7. 限制 UTF-8 序列化结果大小；
8. 写入槽位。

成功结果只保留模型判断所需的数据。错误结果形态稳定为：

```json
{
  "code": "memory_bridge_unavailable",
  "message": "Memory search is temporarily unavailable",
  "request_id": "...",
  "retryable": true
}
```

错误中不包含异常栈、Authorization、API Key、服务端 Token、完整上游错误体或内部配置。

## 9. Internal Re-entry

### 9.1 首次请求快照

第一次转发完成现有 Session Init、Injection Pipeline、路由和 `prepareUpstreamRequest` 后，保存实际成功调用所需的白名单快照：

- protocol；
- 原始 base messages；
- 注入后的 system；
- 合并后的 tools；
- model 与允许复用的请求参数；
- 实际成功的 upstream URL、model 和稳定 target ID；
- 首次请求的 context version。

不持久化任何 Header、API Key、Authorization 或完整 ForwardTarget 私有配置。

### 9.2 重入规则

- 不重新执行 Session Init；
- 不重新执行 Injection Pipeline；
- 不重新做模型路由；
- 不重新执行首次请求 preparation；
- 只追加完整 assistant/tool result 历史；
- 同进程使用首次成功请求的内存 Header；
- 重启恢复时根据持久化 target ID 和当前配置重建鉴权；
- 如果原 target 已不存在、URL/model 不匹配或凭据来源无法恢复，则 fail-closed，不能换路由或换模型。

每次重入生成新的 Tool Batch，但沿用同一用户 turn 的 trace/turn identity。累计轮数和调用数跨所有内部重入计算。

## 10. ClickHouse 状态存储

### 10.1 能力前提

当前环境为 ClickHouse 25.12。状态 Adapter 要求 Lightweight UPDATE，并对每次 CAS 设置：

```text
allow_experimental_lightweight_update = 1
update_parallel_mode = 'sync'
update_sequential_consistency = 1
```

状态表启用 Lightweight UPDATE 所需的 Block 定位列设置。初始化后写入短 TTL 的 probe row，执行 revision CAS 并读回验证。探测失败时：

- `nativeProxyTools.enabled=true` 的请求在注入前返回服务不可用；
- 不注入 Native Tool；
- 不回退内存、Redis 或遥测队列。

### 10.2 表语义

每个 batch 一行，排序键为：

```text
(space_id, user_id, agent_source, session_id, context_version, tool_batch_id)
```

主要列：

- scope/key 列；
- `turn_seq`、`protocol`；
- `call_ids Array(String)`；
- `assistant_skeleton_json`；
- `slots_json`；
- `response_stream_status`；
- `client_dispatch_status`；
- `upstream_snapshot_json`；
- `revision UInt64`；
- `expires_at DateTime64`；
- 创建和更新时间。

状态表使用业务配置的动态 `expires_at` TTL。所有读取额外执行 `expires_at > now()`，确保后台 TTL 尚未物理删除时也不会恢复过期状态。

### 10.3 Adapter 接口

接口覆盖：

- `initializeAndProbe()`；
- `create(context)`；
- `get(key)`；
- `findByCallId(scope, callId)`；
- `findActiveBySession(scope)`；
- `compareAndSetStreamSnapshot(...)`；
- `compareAndSetClientDispatchStatus(...)`；
- `tryClaimSlotExecution(...)`；
- `compareAndSetSlotResult(...)`；
- `markAborted(...)`。

所有 mutation 都是同步可靠调用。CAS 的执行方式为：

1. 读取当前 revision；
2. 在内存中合并最新 skeleton/slot 状态；
3. 单条 `UPDATE ... WHERE key = ... AND revision = expected`；
4. 读回并验证 revision 与本次 token；
5. 冲突时有限次数重新读取、合并和重试；
6. 超过重试上限返回明确并发错误。

表名必须通过 identifier allowlist 校验，所有值使用 ClickHouse query parameters，不能拼接模型输入。

### 10.4 租约语义

- 执行前将 slot 从 `pending` CAS 到 `running`，同时写 lease owner、lease deadline 和 attempt；
- 未过期 lease 只允许当前 owner 写结果；
- lease 时长为 `max(toolTimeoutMs * 2, 10_000ms)`；
- 结果从 `running` CAS 到 `succeeded/failed`；
- 重复结果、旧 lease owner 和并发覆盖都被拒绝。

该语义保证同一时刻最多一个有效租约持有者。若进程在 Bridge 已执行但结果尚未落盘时崩溃，租约到期后只读调用可能重试。因此本轮承诺的是：

- Native 只读工具：at-least-once 执行；
- 槽位结果：exactly-once 接受；
- 并发正常运行时：单一有效执行者；
- 不对未来写工具承诺 exactly-once。

## 11. 配置

新增集中配置：

```yaml
nativeProxyTools:
  enabled: false
  maxRounds: 5
  maxCallsPerRound: 8
  maxTotalCalls: 20
  toolTimeoutMs: 5000
  maxResultBytes: 65536
  stateTtlSeconds: 1800
  stateStorage:
    backend: clickhouse
    table: native_proxy_tool_execution_state
```

规则：

- YAML、TypeScript 类型、默认值、范围校验、示例和中英文 README 同步；
- `maxRounds >= 1`；
- `maxCallsPerRound >= 1`；
- `maxTotalCalls >= maxCallsPerRound`；
- `toolTimeoutMs`、`stateTtlSeconds` 和 `maxResultBytes` 设合理上下界；
- ClickHouse URL、database、user、password 复用现有 `clickhouse` 配置；
- backend 首期只接受 `clickhouse`；
- enabled=false 不触发 ClickHouse 状态初始化，也不注册 Fake Tool。

阶段二、三使用固定 `contextVersion="v1"`。Context Compression 引入新的版本与 checkpoint 属于后续阶段。

## 12. 错误、限制与安全

### 12.1 协议错误

以下错误由 Proxy 直接拒绝，不交给模型猜测修复：

- 已知批次中的未知 `call_id`；
- 同一请求重复 `tool_result`；
- 结果对应错误 owner；
- assistant skeleton 损坏；
- 跨 tenant/user/session 的 call ID；
- 已过期批次；
- ClickHouse CAS 持续冲突或不可用。

### 12.2 可恢复工具错误

以下错误转换为 `is_error=true` Tool Result 后允许模型继续：

- 参数校验失败；
- Memory Bridge 业务无结果或可解释业务错误；
- 网络超时；
- 临时 429/5xx；
- 结果超过限制。

### 12.3 循环限制

Coordinator 在每次 Tool Call 完整时检查：

- 当前 round 调用数；
- 当前用户 turn 累计调用数；
- 内部重入 round 数。

超过限制时不执行新的 Native Tool，不向客户端发送该调用，返回标准 Proxy/Anthropic 错误并结束隐藏循环。由于所有上游字节在裁决前被缓存，错误发生时仍能保证 Native Tool 零泄漏。

### 12.4 数据最小化

- upstream snapshot 仅保存重入白名单；
- skeleton、slots、input 和 result 均执行序列化大小检查；
- 普通日志和 Langfuse 默认不记录完整输入、结果或 skeleton；
- 记录工具名、call ID、batch ID、状态、耗时、结果字节数和错误 code；
- ClickHouse 状态只用于短期恢复，由逻辑过期和 TTL 回收，不作为长期审计表。

## 13. 观测集成

每次上游模型调用仍属于同一个用户 turn trace，并记录为独立 Generation。至少增加以下可观测点：

- SSE 完成或中断；
- Native 参数完成时间；
- 状态首次落盘时间；
- lease 认领结果；
- Bridge 开始、结束、错误和结果大小；
- Client dispatch 时间；
- Client Result 到达时间；
- Internal Re-entry 次数；
- 零泄漏检查失败；
- 恢复和租约重试。

现有 L0 写入和 Skill extraction 只应针对用户可见的最终逻辑轮次执行，不能把隐藏的中间 Native round 当作新的真人轮次重复写入。

## 14. 测试策略

实现采用 TDD，每个行为先写失败测试。

### 14.1 Adapter 单元测试

- 跨 chunk SSE framing；
- CRLF、多行 data 和空帧；
- text；
- thinking + signature；
- `input_json_delta` 多分片；
- JSON 中途可解析但尚未 stop；
- 多 Native/Client Tool 交错；
- Provider opaque block；
- malformed frame；
- EOF before `message_stop`。

### 14.2 Registry/Dispatcher 测试

- Schema 和 snake_case 名称；
- 未知字段、空 query、超长 query、limit 边界；
- 身份字段不能由模型覆盖；
- Memory Bridge 成功、业务错误、超时、异常脱敏和结果截断；
- 同名客户端工具冲突。

### 14.3 Coordinator 测试

- 无工具与纯 Client 原始字节回放；
- Native 在 `content_block_stop` 后、`message_stop` 前开始；
- 纯 Native 内部重入；
- Native Tool error 结果回填；
- 循环轮数和调用数上限；
- SSE 中断不重入；
- 混合响应过滤和连续 index；
- Native name/call ID/input 零泄漏；
- 多工具交错和乱序结果按原顺序恢复；
- 首次 system/tools/request params/成功 target 复用。

### 14.4 Storage 契约测试

同一套契约分别运行在测试用内存 Adapter 与 ClickHouse Adapter：

- create/get/find；
- revision CAS；
- stream snapshot 与结果并发更新的合并；
- 两个并发 owner 只有一个持有有效 lease；
- lease 过期后重新认领；
- 重复 Tool Result；
- 未知 call ID；
- Client dispatch CAS；
- logical expiry；
- 新 Adapter 实例从既有状态恢复。

### 14.5 本地 ClickHouse 集成测试

使用当前 Native ClickHouse 配置，在独立数据库内创建带随机后缀的临时表：

1. 验证 DDL 和能力 probe；
2. 并发发起 lease claim；
3. 验证只产生一个有效 owner；
4. 验证并发 snapshot/result 不丢字段；
5. 验证 logical expiry；
6. 测试完成后删除本次唯一临时表。

测试不得读取或输出 ClickHouse 密码，不得操作既有业务表。

### 14.6 Handler 集成测试

- MemoryProxy 只读取上游 body 一次；
- 纯 Client 直到 `message_stop` 后才返回；
- Client 结果先到、Native 结果后到；
- 模拟进程重启后恢复；
- 实际成功 target 而非重新路由目标被重用；
- enabled=false 时请求中无 Native/Fake Tool；
- Native Tool 在所有客户端响应中零泄漏。

### 14.7 回归检查

- 现有 14 个 Vitest 测试继续通过；
- `npm run typecheck` 不新增错误，并尽量清理当前基线已有的五个错误；
- `rg` 扫描 Native 源码、README 和配置示例，不再存在 Fake Tool/curl 指南；
- Shell QA 脚本保持通过；
- 子仓库 diff 只包含本任务文件。

## 15. 完成定义

满足以下全部条件才视为阶段二、三完成：

1. Anthropic Adapter 只在 `content_block_stop` 产生完整 Tool Call；
2. 成功 SSE 只有一个上游消费者；
3. Native Tool 在 `message_stop` 前可开始执行；
4. Client Tool 只在 `message_stop` 后下发；
5. 纯 Client 响应无损回放；
6. 纯 Native 和混合 Tool Loop 均能重入并返回最终结果；
7. 多槽位乱序完成仍恢复原始顺序；
8. ClickHouse 可靠保存状态，并通过并发 lease/CAS 测试；
9. Client-first、重启恢复、重复结果、未知 ID、并发冲突和过期状态均有自动化测试；
10. SSE 中断不使用不完整历史重入；
11. Native Tool 不出现在任何客户端响应；
12. Native 项目无 Fake Tool 文本注入、curl 指南或关闭后的回退路径；
13. 配置、README、测试和实现一致；
14. 全量验证结果可复核。

## 16. 已知基线

设计勘察时，Native MemoryProxy 的现有 Vitest 基线为 5 个测试文件、14 个测试全部通过。现有 `npm run typecheck` 有五个已存在问题：请求分类类型不一致、Codex request log 字段、Raw YAML `memCommand` 缺失，以及私有 cost-guard alias 缺失等。本任务实现不得掩盖这些基线；与改动路径直接相关的问题做最小修复，私有可选依赖问题则提供不污染运行时的类型声明或在交付说明中单独列出。
