# Native Proxy Tool 阶段二至五功能实现与测试验收报告

> 验收日期：2026-08-31<br>
> 对照方案：`Native Tool课题目标与技术实施方案（内部）.md`<br>
> 验收范围：阶段二至阶段五，以及与其直接相关的工程验收项<br>
> 明确排除：Knowledge Tool、OpenAI Responses Adapter、阶段六正式 A/B 结论

## 1. 结论摘要

Native Proxy Tool 的核心能力已经实现，并且不是仅依靠 Mock 证明：本次使用功能分支启动了隔离的 MemoryProxy 实例，让真实 DeepSeek 上游分别通过 Anthropic Messages 和 OpenAI-compatible Chat Completions 收到结构化 Tool Schema；模型实际生成 `tdai_memory_search`/`skill_search` 调用，Proxy 经 Memory Bridge/Skill Bridge 执行、持久化结果并进行 Internal Re-entry，客户端只收到最终自然语言答案，未出现 Native Tool 名称、参数或 `call_id` 泄漏。

综合结论为“核心闭环通过、工程整体有条件通过”，不能表述为方案中除排除项外已经无缺口：

- 阶段二、阶段三的 Anthropic 流式闭环、Client/Native 混合编排和 ClickHouse 可靠状态能力已实现，测试证据充分。
- 阶段四的 6 个 Memory Tool、10 个 Skill Tool、Schema/身份/错误/超时/重试/截断/上限能力已实现；启用 Native 且 Memory/Skill capability 可用、`allowLlmWrite=false` 时暴露 6 个 Memory Tool 与 4 个安全 Skill Tool，6 个写 Skill Tool 受 `allowLlmWrite` 开关控制。
- 阶段五的 OpenAI-compatible 保守轮末执行、Provider Tool 透传和 Context Compression Checkpoint 已实现；OpenAI-compatible 的真实 Native Tool 闭环已跑通。
- 仍有三个进入正式 A/B 前应先处理的高优先级问题：功能分支尚未合入根仓库当前 Native 子模块指针；Skill Catalog 注入文本与已存在的 Native Skill Tool 相矛盾；OpenAI-compatible Native 最终轮没有接入 Anthropic 已有的 Generation 观测和持久化 writeback 消费器。
- 当前 Eval Harness 自身测试通过，但现有 smoke 配置仍指向旧 Native 工作树/服务，其 Native `definition_tokens=0`、`internal_reentry_rounds=0`，不能作为本次 Native Proxy Tool 的 A/B 结果。

因此，建议下一步优先做一次范围明确的 Native 项目 debug/集成收口，再运行正式 A/B；现在直接扩充数据集会把部署与采集缺口误当成模型 Tool Selection 结果。

## 2. 代码与仓库状态

### 2.1 实现所在位置

本次验收针对以下功能工作树，而不是根仓库当前检出的 Native 子模块目录：

| 项目 | 值 |
|---|---|
| 功能工作树 | `TencentDB-Agent-Memory-Native/.worktrees/anthropic-native-proxy-tools` |
| 功能分支 | `codex/anthropic-native-proxy-tools` |
| 功能 HEAD | `641c2bc502ead7f0a3ce2de6fd32798ab7d6954c` |
| 共同基点 | `67288102d1e5a30b650104135a6e983d7d3635d8` |
| 功能提交数 | 18 |
| 相对基点变更 | 83 files，+16,768 / -1,433 |
| 工作树状态 | clean |

根仓库 `HEAD` 的 `TencentDB-Agent-Memory-Native` gitlink 仍为 `30dfa53489fb654f55654cf6487b1d2bf505dec5`；该提交位于 `research/native-tool`，与功能分支从共同基点分叉，二者均不是对方祖先。也就是说，当前根仓库的普通 checkout、`tencentdb-memory-lab` 的 Native 服务以及现有 Eval 配置不会自动使用 `641c2bc` 的实现。

本报告只提交验收文档，不擅自合并两条 Native 分支，也不改动用户已经存在的根仓库暂存区/工作区内容。功能实现本身已经保存在上述 18 个提交中。

### 2.2 主要实现文件

| 能力 | 主要文件 |
|---|---|
| Tool Registry 与严格 Schema | `MemoryProxy/src/native-proxy-tools/tool-registry.ts` |
| Injection Pipeline 结构化注入 | `MemoryProxy/src/native-proxy-tools/native-proxy-tools-injector.ts`、`MemoryProxy/src/injection/index.ts` |
| Anthropic 增量解析 | `MemoryProxy/src/injection/adapters/anthropic-stream.ts` |
| Anthropic Tool Loop | `MemoryProxy/src/native-proxy-tools/tool-loop-coordinator.ts` |
| Anthropic 客户端响应重建 | `MemoryProxy/src/native-proxy-tools/anthropic-response-rebuilder.ts` |
| Client Tool Result 恢复 | `MemoryProxy/src/native-proxy-tools/client-tool-resume.ts` |
| OpenAI-compatible 解析与闭环 | `MemoryProxy/src/injection/adapters/openai-stream.ts`、`MemoryProxy/src/native-proxy-tools/openai-tool-loop-coordinator.ts` |
| OpenAI 客户端响应重建 | `MemoryProxy/src/native-proxy-tools/openai-response-rebuilder.ts` |
| Dispatcher 与工程边界 | `MemoryProxy/src/native-proxy-tools/native-proxy-tool-dispatcher.ts` |
| Memory/Skill Bridge Executor | `MemoryProxy/src/memory/memory-bridge.ts`、`MemoryProxy/src/skill/skill-bridge.ts` |
| ClickHouse 状态 Adapter | `MemoryProxy/src/db/clickhouse-tool-execution-storage-adapter.ts` |
| Runtime/readiness/shutdown | `MemoryProxy/src/native-proxy-tools/runtime.ts` |
| Context Compression | `MemoryProxy/src/native-proxy-tools/context-compression.ts`、`MemoryProxy/src/handler.ts` |
| Anthropic/OpenAI Handler 接入 | `MemoryProxy/src/anthropicHandler.ts`、`MemoryProxy/src/handler.ts` |

## 3. 已实现的功能

### 3.1 Tool Registry 与暴露策略

Registry 统一保存工具名、描述、Schema、Owner、Backend、Effect、Bridge Route 和运行时校验器。所有 Schema 都是 `type: object` 且 `additionalProperties: false`，运行时校验与注入给模型的 Schema 共用同一注册项，避免“描述允许、执行器拒绝”的双份定义漂移。

已注册工具如下：

| 类别 | 工具 | 默认暴露 |
|---|---|---|
| Memory 只读 | `tdai_memory_search`、`tdai_atomic_query`、`tdai_conversation_search`、`tdai_conversation_query`、`tdai_scenario_ls`、`tdai_read_scene` | 是；还受 Session 与 `chat_memory` capability 控制 |
| Skill 只读/归档 | `skill_search`、`skill_view`、`skill_files_read`、`skill_extract` | 是；还受 Skill 配置与 capability 控制 |
| Skill 写入 | `skill_create`、`skill_update`、`skill_patch`、`skill_delete`、`skill_files_write`、`skill_files_remove` | 否；仅 `allowLlmWrite=true` 时暴露 |

注入器只处理已初始化且身份字段完整的 Session，只支持流式 Anthropic/OpenAI 请求，会拒绝 Client Tool 占用 Proxy 保留名称。`nativeProxyTools.enabled=false` 时不注入 Native Schema，也不恢复 Fake Tool 文本。

### 3.2 Anthropic 流式状态机

Anthropic Parser 增量保留原始 SSE 帧、文本、thinking/signature、普通 Tool、Provider Block 和分片 JSON。只有相应 `content_block_stop` 到达后才发出统一 `tool_call_completed`，不会因为中途字符串恰好可解析为 JSON 而提前完成。

Coordinator 成为上游 SSE 的唯一消费者，并按以下时序处理：

1. Native 只读 Tool 在 `content_block_stop` 后创建/更新可靠状态并立即尝试执行；写入型 Skill Tool 延迟到完整 `message_stop`。
2. Client Tool 只收集，不在流中提前下发；到 `message_stop` 后一次性重建客户端可见响应。
3. 纯 Native 轮等待结果终态，按原始 Assistant 骨架追加 Tool Result，使用首次请求保存的 system/tools/参数/实际成功上游目标进行内部续轮。
4. 混合轮先隐藏 Native 帧并下发 Client Tool；Client Result 回来后按 `call_id` 更新槽位，必要时等待先前 Native 结果，再进行一次受租约保护的续轮。
5. 所有客户端返回字节在提交/回放前执行 Native 名称、调用 ID、参数和注册表描述泄漏扫描，发现风险时 fail closed。
6. 上游非 2xx、SSE 协议损坏或 `message_stop` 前中断不会拿不完整骨架续轮；已创建批次标记为 `aborted`。

### 3.3 消息骨架、槽位与乱序归并

每个 Tool Call 保存独立的 `callId`、`slotIndex`、`contentBlockIndex`、owner、参数完整状态、执行租约、结果和错误标记。Assistant Skeleton 负责保留协议顺序，结果归并只依赖 `call_id`，不依赖工具名或完成先后顺序。因此同名多调用、Native/Client 交错生成、Claude Code 结果先到以及 Native 结果后到均可恢复。

纯 Client Anthropic 响应在完整轮末按原字节回放；混合响应只移除 Native 所属 Block，并重新映射客户端可见 index。Provider Block 不进入 Proxy/Client 槽位，也不会被伪造成普通函数工具。

### 3.4 ClickHouse 可靠状态

`ClickHouseToolExecutionStorageAdapter` 使用独立可靠读写路径，而不是复用 best-effort 遥测队列。主要语义包括：

- 启动创建/探测 MergeTree 表、同步 Lightweight UPDATE 和 TTL 能力；不可用时 Native Runtime fail closed，不降级内存/Redis。
- 执行前先持久化批次和槽位，再通过 revision CAS 原子认领执行租约。
- 状态创建有重复保护，结果只接受当前租约 owner 一次，流式快照与结果并发更新通过字段合并和 CAS 避免覆盖。
- 持久化 Client 下发状态、Client Result、re-entry lease/outcome、最终响应快照、observation outbox、上游安全快照和 Compression Checkpoint。
- 读取按 space/user/agent/session/context version/batch 隔离，并在物理 TTL 删除前先执行逻辑过期过滤。
- 上游快照采用允许列表，不保存请求 Header、API Key、Authorization 或完整凭据；重启后只从可信当前配置重建允许的鉴权。

### 3.5 Memory/Skill Bridge 与 Dispatcher 边界

Dispatcher 在调用 Bridge 前执行 Registry 校验和默认值归一化，模型参数不能设置 user/team/agent/space、Bridge URL、Header 或凭据。Memory Executor 覆盖模型身份并使用可信 Session 身份，可对固定资产范围 fan-out 后按分数合并；Skill Executor 复用 Skill Bridge 的身份盖章、权限和版本锁语义。

错误统一为有界结构化结果；未知异常不返回栈和原始响应。网络错误、超时、429 和可恢复 5xx 可重试，版本冲突和其他确定性 4xx 不重试。工具级超时即使 Bridge 忽略 Abort 也会生效；过大结果返回 UTF-8 安全的省略对象，而不是截断成无效 JSON。

### 3.6 OpenAI-compatible 与 Provider Tool

OpenAI Parser 在一个 Tool Call 没有显式完成事件时保守等待整个流式轮次边界，随后一次性产生完成事件。Coordinator 复用统一 Registry、Dispatcher、状态 Adapter、槽位和泄漏扫描语义，能够隐藏 Proxy function-call delta、保留 Client function call 和 Provider 专用块，并构造有序 assistant/tool messages 进行内部续轮。

本次真实模型黑盒已经证明 `/v1/chat/completions` 路径能收到 10 个结构化定义、生成 Native Memory 调用、执行 Bridge 并返回隐藏续轮后的最终答案。

### 3.7 Context Compression

Compression 准备阶段按可信 Scope 查找“响应完整、包含 Native 槽位、结果均为终态、尚无 Checkpoint”的状态，按 turn/round 排序，把隐藏 Assistant Tool Call 和 Tool Result 插入待压缩消息历史。只有压缩上游成功并且流完整结束后才通过 CAS 写入 Checkpoint；后续准备会过滤已覆盖状态，实现逻辑失效，物理记录仍由 TTL 回收。

当前该能力已接入 OpenAI handler 的 auxiliary/compaction 路径并有单元测试，但没有在本轮执行真实 Claude Code 压缩黑盒。

### 3.8 Fake Tool 移除

原模型侧 Memory/Skill/Knowledge Fake Tool Injector 已从功能分支删除或停止注册。现有 Skill/Memory Injector 只保留资产/长期上下文，Bridge 仍作为可信业务 API 存在，但不再向模型注入 Bridge URL、Header、curl Envelope 或重试脚本。README 中出现的健康检查 curl 属于运维示例，不是模型注入内容。

## 4. 方案目标验收矩阵

状态含义：通过＝实现并有直接测试；条件通过＝核心已实现但存在集成/观测或测试层级缺口；排除＝按本次要求不验收。

| 目标 | 状态 | 证据/说明 |
|---|---|---|
| Anthropic 在 `content_block_stop` 产生完成事件 | 通过 | Parser 分片/CRLF/CR/UTF-8/坏 JSON 测试；Coordinator 门控测试 |
| MemoryProxy 成为唯一 SSE 消费者并提前执行 Native | 通过 | Coordinator gate 测试证明执行发生于 block stop 后、message stop 前；真实 Anthropic 调用成功 |
| 首次注入结果和实际上游目标复用 | 通过 | exact-target transport、重启恢复与 handler 集成测试 |
| 工具错误、循环限制、中断、零泄漏 | 通过 | Dispatcher、Coordinator、rebuilder、handler 集成测试 |
| 无 Fake Tool/curl 回退 | 通过 | 注入输出断言与源码检索；关闭 Native 时结果为空 |
| Native 立即执行、Client 轮末下发 | 通过 | gate、纯 Client byte-for-byte、混合调用测试 |
| 消息骨架、有序槽位、交错和乱序完成 | 通过 | response rebuilder、同名多调用、call_id 归并测试 |
| ClickHouse 可靠保存、CAS、租约、结果、TTL | 通过 | 存储契约测试、Adapter 测试及 4 个真实 ClickHouse 并发测试 |
| Client 结果先到、重启、重复结果、未知 call_id | 通过 | handler 集成与 client-tool-resume 测试 |
| 全部 Memory/Skill Tool 注册 | 通过 | Registry 断言固定顺序的 6+10 个工具 |
| Schema、身份、错误、超时、重试、截断、上限 | 通过 | Registry/Bridge/Dispatcher/Coordinator 测试 |
| 纯 Native、纯 Client、混合、同名、无结果 | 通过 | 单元/集成夹具；真实 Memory 与 Skill 无结果调用 |
| OpenAI-compatible 保守轮末执行 | 通过 | Parser/Coordinator 测试与真实模型黑盒 |
| Provider Server Tool 无损透传 | 通过 | Anthropic Adapter、Anthropic/OpenAI rebuilder 测试；未做真实 Provider Server Tool 网络黑盒 |
| Compression 隐藏历史与成功后 Checkpoint | 条件通过 | 实现已接 handler，单元测试通过；未做进程级真实压缩/失败恢复黑盒 |
| 每次内部模型调用形成同 Trace 的独立 Generation | 条件通过 | Anthropic 真实调用为同 Trace 两个 Generation；OpenAI 真实调用只有 injection span，没有 Generation |
| 最终逻辑轮 writeback/outbox | 条件通过 | Anthropic 已消费并完成；OpenAI 真实状态停在 `observation=pending`，无消费者接入 |
| Native Skill 的模型侧引导一致 | 未通过 | `skill-injector.ts` 仍明确声称“不存在模型侧 Skill 工具”，与同请求注入的 Skill Schema 冲突 |
| README/config.example 与最终能力同步 | 未通过 | 仍描述“Anthropic 唯一 `tdai_memory_search`”，没有反映 6+10 Tool 与 OpenAI-compatible |
| Knowledge Tool | 排除 | 用户明确不要求本轮实现/验收 |
| OpenAI Responses Adapter | 排除 | 方案和用户均明确排除 |
| 阶段六正式 A/B | 排除 | 当前仅检查 Harness 和已有 calibration smoke 是否可用于下一步 |

## 5. 白盒与灰盒测试结果

### 5.1 MemoryProxy 全量测试

在功能工作树 `MemoryProxy` 目录运行：

```bash
npm test -- --reporter=verbose
npm run typecheck
```

结果：

- Vitest：26 个文件通过、1 个文件按环境门控跳过；291 个测试通过、4 个真实 ClickHouse 测试跳过。
- TypeScript：`tsc --noEmit` 通过。
- 项目没有独立 `build` script，`typecheck` 是当前静态构建门禁。

### 5.2 真实 ClickHouse Adapter 测试

通过本地测试环境已有 ClickHouse 配置显式设置 `NATIVE_TOOL_CLICKHOUSE_TEST=1`，运行：

```bash
npx vitest run scripts/qa/__tests__/clickhouse-native-tool-state.integration.test.ts --reporter=verbose
```

4/4 通过：

1. 两个 Adapter 并发认领时只有一个有效执行租约。
2. 并发创建同一批次时只有一个创建者成功。
3. Client Result re-entry 可跨 Adapter 实例认领、续租、完成并消费 observation。
4. 流式快照与 Native 结果竞争更新时二者均不丢失。

测试使用随机唯一表，并由测试 teardown 删除。结合全量测试，功能工作树的 27 个测试文件、295 个测试用例均在本轮至少成功执行一次。

### 5.3 重点测试覆盖

以下场景均有直接断言：

- Anthropic：碎片参数、`content_block_stop` 门控、CRLF/CR、多行 SSE、跨 chunk UTF-8、thinking/signature、Provider Block、坏 JSON、不完整 EOF。
- 编排：纯 Native、纯 Client、混合、多个 Native、写工具延迟、限制、上游非 2xx、流中断、隐藏标记泄漏。
- 恢复：Client Result 先到、租约过期再认领、重复结果幂等、未知/跨 Scope `call_id`、失败续轮重试、持久化最终响应回放。
- 存储：敏感字段拒绝、持久化大小限制、重复创建、执行/续轮/observation 租约、CAS、逻辑过期、Compression Checkpoint。
- Bridge：可信身份覆盖、Memory fan-out、Skill 权限、网络异常与空结果。
- OpenAI：交错 function call、轮末完成、Provider chunk、混合过滤、隐藏历史重建、中断不执行。

### 5.4 Eval Harness 自检

在根仓库 `eval_kit` 目录运行：

```bash
npm test -- --reporter=verbose
npm run typecheck
```

结果为 11 个文件、34 个测试全部通过，TypeScript 检查通过。已覆盖配对调度、断点恢复、超时/不完整轨迹、Recorder 稳定等待、工具归一化、Token 估算、指标、路径安全和 Viewer XSS 边界。

这只能证明 Harness 的代码结构可用，不能证明现有 smoke 已经测到本功能分支，详见第 8 节。

## 6. 真实模型黑盒测试

### 6.1 环境与方法

- 从功能工作树启动独立进程，使用隔离端口 28096（Anthropic）和 28097（OpenAI-compatible），没有修改当前 18096 的 Native 服务。
- 上游模型：`deepseek-v4-flash`。
- 复用本机真实 Memory/Skill Bridge、ClickHouse 和 Langfuse；测试状态写入专用临时表。
- 为避免改变生产认证数据，隔离进程关闭入口 auth，并使用 debug 强制测试身份；因此本测试验证 Tool 注入/调用/Bridge/续轮，不宣称覆盖完整生产 auth handshake。
- Prompt 明确要求模型调用指定工具，目标是验证协议与执行闭环，不用于评估模型自然 Tool Selection 倾向。
- 初始请求因 Node 子进程缺少 `NODE_USE_ENV_PROXY=1` 和小写 `no_proxy` 无法访问上游；补齐与现有实验服务一致的进程网络环境后全部连通。这是启动环境问题，不是 Native Tool 代码失败。

### 6.2 Anthropic + Memory Tool

会话：`native-acceptance-20260831-0613`<br>
Langfuse Trace：`56d2f9af6c7e4e0d6c7e4c27728c4cee`

观察结果：

- Injection span `[inject] native-proxy-tools-injector @ tools.append` 记录 `blockCount=10`、`protocol=anthropic`。
- 同一 Trace 有两个 `deepseek-v4-flash` Generation：round 1 usage 为 input 2594/output 124；round 2 为 input 85、cache read 2688、output 40。这与“模型先调用工具、Proxy 隐藏执行、再内部续轮”一致。
- Proxy 日志记录 Memory Bridge `atomic/search` 成功、0 条结果，耗时约 13 ms。
- ClickHouse 最终状态：`protocol=anthropic`、round 1、1 个调用、stream completed、Client dispatch none、observation completed、slot `tdai_memory_search`/proxy/succeeded、execution attempt 1。
- 客户端最终答案为“记忆中未检索到任何已记录的代码规范条目，结果为空。”，包含完整 `message_stop`；响应中没有 `tdai_memory_search` 和 Native `call_id`。

### 6.3 Anthropic + Skill Tool

会话：`native-skill-acceptance-20260831-0616`<br>
Langfuse Trace：`33b76c3f11708ca8ce99ebef83a52b2b`

观察结果：

- 同样注入 10 个 Tool Schema，并在同一 Trace 记录两个 Generation。
- 第一次使用无有效用户密钥的测试证明 Bridge 异常会转换为隐藏的结构化 `skill_bridge_unavailable`，客户端仍无 Native 协议泄漏。
- 使用有效测试身份再次执行后，Skill Bridge `search` 成功、返回 0 项。
- ClickHouse 最终 slot 为 `skill_search`/proxy/succeeded、execution attempt 1，stream 与 observation 均 completed。
- 客户端最终答案为“在团队 Skill 中未检索到与 MemoryProxy injection 相关的任何匹配项（返回结果为空）。”；响应中没有 `skill_search` 和 Native `call_id`。

### 6.4 OpenAI-compatible + Memory Tool

会话：`native-openai-acceptance-20260831-0618`<br>
Langfuse Trace：`2876dfab3689ea71824a81ebaf187214`

观察结果：

- Injection span 记录 `blockCount=10`、`protocol=openai`，真实上游 URL 为 `/v1/chat/completions`。
- 模型生成 `tdai_memory_search`，Memory Bridge `atomic/search` 成功、0 条结果，耗时约 9 ms。
- ClickHouse slot 为 proxy/succeeded、arguments complete、execution attempt 1；保存的实际目标为 `deepseek-v4-flash`，响应流状态 completed。
- 客户端收到 HTTP 200、`[DONE]` 和最终答案“项目中尚未记录任何代码规范（检索结果为空）。”；没有工具名和 `call_id`。

同时发现两个需要复查的 OpenAI 边界：

1. 该 Trace 只有三个 injection span，没有初始/续轮 Generation；Anthropic 同类请求有两个 Generation。
2. 持久化状态在进程正常运行约 9 分钟后仍为 `observation=pending`、attempt 0、revision 3。代码审查也显示 `handler.ts` 创建 OpenAI Coordinator 后直接返回 decision bytes，没有调用 Anthropic 的 `observeNativeToolDecision` 等价逻辑或 observation outbox consumer。

这说明 OpenAI Native Tool 执行和 Internal Re-entry 本身成功，但普通最终轮的观测/计费/writeback 链路没有闭合。该问题会让 Eval Recorder 低估 `llm_calls`、`internal_reentry_rounds`，也可能遗漏 L0/Skill 轮末写回。

另有一项低置信度传输现象：OpenAI curl 进程在已经收到 HTTP 200、完整最终内容和 `[DONE]` 后返回 255。响应协议内容完整，尚未用 Claude SDK/第二种 HTTP 客户端稳定复现，暂不判为实现失败，但建议 debug 时确认连接收尾。

### 6.5 测试资源清理

黑盒测试结束后已正常停止两个隔离 Proxy 进程，并删除：

- 临时 ClickHouse 表 `native_proxy_acceptance_20260831`（4 行测试版本记录）。
- 临时 ClickHouse 表 `native_proxy_openai_acceptance_20260831`（1 行测试版本记录）。
- `/tmp` 中包含测试配置、Header 和 SSE 的 10 个临时文件。

Langfuse Trace 保留，作为本报告的可追溯观测证据。未删除或修改现有 18096 服务、业务表和用户数据。

## 7. 已知缺口与风险

### P1：功能分支未进入根仓库 Native 指针与实验服务

根仓库、`eval_kit/configs/experiments/smoke.yaml` 和 `tencentdb-memory-lab` 当前仍指向 `TencentDB-Agent-Memory-Native` 的 `research/native-tool`/18096 服务，而实现位于独立 worktree 的 `codex/anthropic-native-proxy-tools`。在合并、更新 gitlink、部署并健康检查之前，任何标为 `native` 的正式实验都可能实际上没有 Native Schema。

需要先把 `30dfa53` 的 debug trace 改动与 `641c2bc` 的功能分支合并，解决分叉后再更新根仓库 gitlink；不要仅修改 Eval 的 `expected_branch` 来掩盖代码未部署。

### P1：Skill 注入文字与 Native Skill 能力冲突

`MemoryProxy/src/injection/injectors/skill-injector.ts` 仍写入：

- “This deployment does not expose a model-facing Skill execution, loading, or editing tool.”
- “本阶段没有提供给模型的 Skill 调用、读取或修改工具。”

但同一请求已注入 `skill_search`、`skill_view`、`skill_files_read`、`skill_extract`，必要时还会注入写工具。该冲突很可能压低非强制 Prompt 下的 Skill 调用率，是正式 A/B 前必须修复的行为问题。目录仍可保持精简，但文字应说明可通过已提供的结构化 Skill Tool 搜索/读取，并按开关说明写能力。

### P1：OpenAI 最终轮观测/writeback 未闭环

`OpenAIToolLoopCoordinator` 会准备 observation，但 OpenAI handler 没有消费它，也没有把各 round snapshot 交给现有 usage/Langfuse pipeline。需要增加与 Anthropic 等价但协议适配的 snapshot observer，并确保：

- 中间隐藏轮只记录 Generation/usage，不触发最终副作用。
- 最终可见轮触发一次持久化 observation outbox。
- 成功后把状态从 pending 原子推进到 completed。
- 重启后可恢复 pending/running observation。
- 同一逻辑 turn 的各次上游请求落到一个 Trace 的独立 Generation。

### P2：文档和配置说明滞后

`README.md`、`README_CN.md`、`config.example.yaml` 仍把功能描述为“仅 Anthropic、唯一只读 `tdai_memory_search`”。`skillRuntime.allowLlmWrite` 的注释也说“不产生模型提示”，没有说明它会控制 Native 写 Skill Tool 的 Schema 暴露。实现和单测已超过这些文档，需要同步后再交付给部署/评测人员。

### P2：关键恢复场景缺少进程级黑盒

以下内容有单元/集成或真实 Adapter 证据，但本轮没有进行完整外部进程黑盒：

- 真正 kill/restart Proxy 后恢复混合 Client/Native 轮次。
- 真实 Claude Code Client Tool 与 Native Tool 同轮交错。
- 真实 Provider Server Tool 网络响应。
- 真实 Context Compression 成功/失败与重启恢复。
- Skill 写工具真实后端调用；为避免产生业务副作用，本轮只做白盒测试。

这些适合放入 debug acceptance suite，不应混入衡量模型 Tool Selection 的主 A/B 数据集。

## 8. Eval Harness 当前状态与已有 smoke 的有效性

Harness 的代码骨架已经具备 Dataset、成对调度、Runner、Tap、Langfuse/ClickHouse Recorder、Metric Engine、版本快照和 Case Viewer；4 个 calibration case 包含 Memory、Skill 和两个负样本，34 个测试通过。

但 `native-proxy-tool-smoke-v1/v2/v3-20260831` 不能用于判断本实现收益：

- smoke 配置的 Native repo 是普通 `TencentDB-Agent-Memory-Native`，服务是 18096，不是本次 28096/28097 的功能实例。
- 配置的 Native `content_sources` 只有旧 `anthropicHandler.ts` 与 `injection/registry.ts`，未包含 `native-proxy-tools/tool-registry.ts`。
- 三轮结果中 Native `definition_tokens` 均为 0，`internal_reentry_rounds` 均为 0；这与本次真实黑盒的 `blockCount=10`、两次 Anthropic Generation 明显不一致。
- 当前数据集只有 4 个 calibration case，且历史 smoke 的 Baseline/Native 工具行为高度相似，不能替代阶段六正式数据集和工程可靠性集。

因此现有 smoke 只能保留为 Harness 联调记录，不应引用其 Token、延迟或准确率数字作为 Native Proxy Tool 的决策依据。

## 9. 下一步建议

建议选择“先 debug/集成收口，再完善 Eval Harness 并正式 A/B”，顺序如下：

1. 合并 `research/native-tool@30dfa53` 与 `codex/anthropic-native-proxy-tools@641c2bc`，更新根仓库 gitlink，并让 lab Native 服务明确打印/暴露实际 commit。
2. 修复 Skill Catalog 的否定性能力提示，同步 README/config.example；增加一个断言，确保注入文本不会否定当前 Registry 已暴露的工具。
3. 补齐 OpenAI round telemetry 与 observation outbox consumer，并复测状态 completed、两个 Generation 和普通轮末 writeback。
4. 增加进程级 acceptance：自然选择 Memory/Skill、纯 Client、混合、服务重启、Provider Tool、Compression、SSE 中断；工程用例与模型选择用例分开计分。
5. 修改 Eval preflight：Native variant 必须校验期望 commit、`nativeProxyTools.enabled=true`、ClickHouse readiness、注入 span `blockCount>0`；正样本出现 Native Tool 时应校验至少一个 internal re-entry。
6. 更新 Native Token content source 为 Registry 结构化 Schema，并使 Recorder 能从工具状态/专用事件读取隐藏 Native call，而不是依赖被刻意净化的客户端流。
7. 上述条件通过后，再扩充人工复核的正/负/隐式/混合数据集，执行同模型、同身份、同资产快照的交替 A/B。

## 10. 最终判断

本阶段已经证明以下核心命题：

- Native Proxy Tool 的结构化 Schema 能正常送入真实 LLM。
- LLM 能产生对应 Native Tool Call。
- MemoryProxy 能拦截并通过 Memory/Skill Bridge 正常执行。
- Tool Result 能持久化并用于 Internal Re-entry。
- Anthropic 与 OpenAI-compatible 的客户端响应均可隐藏 Native 协议细节。

所以“Native Proxy Tool 是否已经实现、是否能被 LLM 正常调用”的答案是肯定的。

但从完整方案验收角度，当前仍是“功能分支上的可运行实现”，不是“已合入、已部署、可直接做正式 A/B 的最终 Native 项目”。优先修复第 7 节三个 P1 问题，能显著降低把部署、Prompt 冲突和观测缺失误判为模型效果的风险。
