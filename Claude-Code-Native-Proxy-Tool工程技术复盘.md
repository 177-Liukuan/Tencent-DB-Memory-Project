# Claude Code Native Proxy Tool 工程技术复盘

> 审查日期：2026-09-04
> Native 业务实现基点：`TencentDB-Agent-Memory-Native`，`research/native-tool@88b814f`
> 对照基点：`29d609a`（`v2.0.1-beta.2`）
> 当前 Baseline：`TencentDB-Agent-Memory-Baseline`，`baseline/bugfix-sync@41306b1`
> 事实来源：当前源码、Git 历史、与共同基点的 diff 以及现有测试。本文不把设计文档中的计划当作已实现能力。

除特别标明 Baseline 的路径外，本文中的 `MemoryProxy/...` 均指 `TencentDB-Agent-Memory-Native/MemoryProxy/...`。

## 1. 改造背景与目标

原始项目已经具备 Claude Code、Codex、WorkBuddy 等客户端入口，也有会话初始化、上下文注入、模型选择、Langfuse 记录以及 Memory、Skill、Knowledge 的 HTTP Bridge。它缺少的是模型协议层面的 Proxy Tool。

在共同基点 `29d609a` 中，Memory、Skill、Knowledge 的使用方法由以下三个 Injector 写进 System Prompt：

- `tdai-tools-injector.ts`：说明怎样用 Bash 和 curl 请求 Memory Bridge；
- `skill-tools-injector.ts`：说明 Skill Bridge 的 URL、请求体和返回格式；
- `knowledge-tools-injector.ts`：说明怎样先请求 `tools/list`，再请求 `tools/call`。

模型实际调用的是 Claude Code 的 `Bash`，curl 命令由 Claude Code 执行。这个方案能工作，但有四个直接问题：模型必须准确拼出命令；Bridge URL、请求头和内部调用约定进入提示词；没有 Bash 的客户端无法使用；MemoryProxy 不掌握工具调用过程，无法统一处理混合调用、重试、超时、重复提交和服务重启。

Native 改造的目标是：把这些能力作为协议原生 Tool Schema 交给模型，由 MemoryProxy 判断工具归属、校验参数、补充可信身份、调用 Bridge，并把结果重新提交给同一个上游模型。Claude Code 仍负责执行 `Read`、`Bash` 等本地工具，但看不到由 MemoryProxy 执行的工具调用。

## 2. 原始项目与当前架构变化

### 2.1 Baseline 与 Native 的区别

| 项目 | Baseline | 当前 Native |
|---|---|---|
| 工具如何告诉模型 | System Prompt 中的大段 Bash/curl 说明 | 请求顶层的结构化 `tools` / function schema |
| Memory、Skill、Knowledge 的执行者 | Claude Code 调用 Bash，再由 curl 请求 Bridge | MemoryProxy 在进程内调用对应 Bridge |
| 参数检查 | 主要依赖模型和 Bridge | Registry 校验函数先检查，Bridge 再做业务检查 |
| 身份来源 | curl 请求头和服务端会话 | MemoryProxy 从已确认会话补充，不信任模型给出的身份 |
| 工具结果如何继续对话 | Claude Code 把 Bash 结果发回模型 | MemoryProxy 可直接带结果再次请求模型 |
| Native 与客户端工具同时出现 | 没有 Proxy 层统一处理 | 保存原顺序，Native 由 Proxy 执行，客户端工具轮末下发 |
| 重启和重复请求 | 依赖客户端已有历史 | ClickHouse 保存未完成调用、结果、再次请求状态和隐藏历史 |
| 客户端可见内容 | curl、URL、请求体均可见 | Native Tool 定义、调用和中间结果不发给 Claude Code |
| Native 关闭 | 仍可依赖 Fake Tool 文本 | 不注入 Native Tool，也不提供 Fake Tool 回退 |

### 2.2 当前 Claude Code 请求流程

普通 Claude Code 请求的实际顺序如下：

```text
Claude Code 发出 Anthropic Messages 请求
  → 鉴权并读取原始 messages，取出 UserPromptSubmit 标记
  → 区分主请求、fork 和 WebSearch 辅助请求
  → 会话初始化及身份确认
  → 如果这是已下发客户端工具的结果，先恢复短期状态并直接续写
  → 注入动态上下文和 Native Tool Schema
  → 选择上游模型与协议
  → 补回当前会话中 Claude Code 看不到的已完成 Native Tool 历史
  → 整理请求；必要时把 Anthropic 请求转成 Responses
  → 请求上游模型
  → 流式解析 Tool Call，并由 Tool Loop 决定执行、下发或继续请求模型
```

这里有一个重要顺序：会话初始化、注入和模型选择使用 Claude Code 提交的可见历史；隐藏历史在模型选择完成后补回，只影响真正发给上游的完整上下文。已知的客户端工具结果则更早进入恢复流程，复用首次请求保存的工具定义、参数和上游目标，不重复执行初始化、注入和模型选择。主要入口见 `MemoryProxy/src/anthropicHandler.ts::handleAnthropicMessages()`。

### 2.3 Git 中可以确认的改造阶段

本次改造从共同基点之后逐步形成：

1. `a9c1f3b`～`a3fd344`：增加 Native 配置、Registry、Anthropic 增量解析、Memory Bridge 执行和首次内部续写；
2. `b77565f`～`787cbb4`：加入混合工具、ClickHouse 短期状态、重复提交和重启恢复；
3. `6c7c9f9`～`cd9f3fc`：补齐 Memory/Skill 工具，并区分只读与修改类操作的启动时机；
4. `8f34cfe`～`b76babf`：加入 Chat Completions、Responses 以及三种协议共用的执行核心；
5. `f650900`：支持 Claude Code 继续使用 Anthropic，而 MemoryProxy 到上游改用 Responses；
6. `d5215be` 曾加入基于整段历史摘要值的恢复方案，随后在 `43af4be` 中删除，改成 Claude Hooks、用户轮次标记和追加式 Tool Ledger；
7. `e5f00d0`～`88b814f`：恢复 Baseline Skill 工具名、补充 Knowledge 真工具，并精简 Native 模式提示词。

因此，当前实现不再使用早期的 History Anchor、整段消息 Hash、Compression Receipt 或旧 Checkpoint。

## 3. Native Tool Registry 与 Tool Schema 注入

### 3.1 Registry 是工具定义和执行归属的唯一来源

`MemoryProxy/src/native-proxy-tools/tool-registry.ts` 中的 `NativeProxyToolDefinition` 同时保存：

- 工具名、description 和对模型可见的 `inputSchema`；
- `owner: "proxy"`、后端类型、是否会修改数据、Bridge 路径；
- Memory、Skill、Knowledge 的显示条件；
- 与 Schema 对应的运行时校验函数 `validate()`。

当前共注册 18 个工具：

- 6 个 Memory 只读工具：`tdai_memory_search`、`tdai_atomic_query`、`tdai_conversation_search`、`tdai_conversation_query`、`tdai_scenario_ls`、`tdai_read_scene`；
- 10 个 Skill 工具：`skill_search`、`skill_view`、`skill_files_read`、`skill_extract`、`skill_create`、`skill_update`、`skill_patch`、`skill_delete`、`skill_files_write`、`skill_files_remove`；
- 2 个 Knowledge 工具：`tdai_knowledge_tools_list`、`tdai_knowledge_tool_call`。

这里需要准确区分“Schema 展示”和“执行校验”：模型看到的是 JSON Schema，但运行时没有用 Ajv 直接解释 Schema，而是调用 Registry 中相配套的手写 `validate()`。它检查必填字段、类型、长度、枚举和未知字段，并写入默认值。

### 3.2 注入条件

`MemoryProxy/src/native-proxy-tools/native-proxy-tools-injector.ts::NativeProxyToolsInjector.execute()` 在现有 Injection Pipeline 的 `tools.append` 位置追加工具定义。只有以下条件同时满足才会注入：

- `nativeProxyTools.enabled=true`；
- 请求是受支持协议的流式主请求；
- 会话已经确认，包含可信的 session、team、agent 和 user；
- 相应后端和 Agent 能力已开启。

Memory、Skill 可以独立显示；Skill 修改类工具还需要 `skillRuntime.allowLlmWrite=true`。Knowledge 工具只有在当前 Agent 确实取得至少一个授权 Knowledge 资源目录时才出现。目录来自 `KnowledgeCatalogInjector`，只包含资源 ID、名称和用途，不包含 URL、Token 或 curl 说明。

如果客户端自己声明了 Registry 中的同名工具，Injector 在请求模型前返回冲突错误。原因是模型 Tool Call 只有名称和调用 ID，不能在同名时可靠判断执行者。

### 3.3 当前 System Prompt 的变化

旧的三个 Fake Tool Injector 已删除。Native 模式下仍会注入少量与数据内容有关的上下文：

- `TdaiProfileMemoryInjector` 注入 L3 信息和 L2 场景索引，并提示正文通过 `tdai_read_scene` 获取；
- `SkillInjector` 列出当前可用的云端 Skill，并提示通过真实 Skill 工具读取；
- `KnowledgeCatalogInjector` 列出 Agent 已授权的 Knowledge 资源及两步调用顺序。

工具参数、调用路径、超时、重试和鉴权不再写入 System Prompt，而由 Schema 和代码负责。

### 3.4 身份与权限

`NativeProxyToolDispatcher` 只接受 Registry 判定为 Proxy 所有的调用。Memory、Skill、Knowledge executor 都会重新读取服务端会话，模型不能自行指定 `user_id`、`team_id`、`agent_id` 或凭据。

有一处需要单独注意：`tdai_conversation_search` 和 `tdai_conversation_query` 的 Schema 接受 `session_id`，但 `MemoryProxy/src/memory/memory-bridge.ts::makeOutbound()` 当前会把它覆盖为正在使用的会话 ID。因此代码实际不能按模型传入的其他 session ID 查询；这与 Tool Schema 的表面含义不完全一致，属于后续应单独处理的问题。

## 4. 流式 Tool Call 解析与执行

### 4.1 三种协议怎样确认参数已经完整

模型可能把工具参数拆成许多 SSE 事件。三个 Parser 都保留原始字节和消息结构，同时输出统一的 `UnifiedToolCall`：调用 ID、工具名、归属、工具顺序、原消息位置、完整参数或解析错误。

| 上游协议 | Parser | 调用完成的实际判断 |
|---|---|---|
| Anthropic Messages | `AnthropicStreamParser` | `content_block_start` 建立 block，累积 `input_json_delta`，在对应 `content_block_stop` 生成完成事件 |
| Chat Completions | `OpenAIStreamParser` | 按 `delta.tool_calls[index]` 累积；没有稳定的单次完成事件，等 `finish_reason` 或 `[DONE]` 后统一生成 |
| OpenAI Responses | `ResponsesStreamParser` | 按 `item_id/output_index` 累积，在 `function_call_arguments.done` 或完整 `output_item.done` 时生成 |

普通 function tool 才会进入 Native/Client Tool 处理。协议自己的 Provider/Server Tool 事件不冒充 function call；同协议转发时尽量保留原始字段。

### 4.2 执行时机

Anthropic 和 Responses 能知道单个 Tool Call 何时完整。只读 Native Tool 此时即可在后台启动，与模型剩余输出并行。Skill 修改、删除、文件写入和 `skill_extract` 不提前执行，而是等本次模型响应正常结束后再启动，避免 SSE 中断时出现“这一轮响应失败，但数据已经修改”。Chat Completions 中的所有 Native Tool 都要等轮末确认。

客户端工具即使已经完整，也不会逐个发给 Claude Code；MemoryProxy 必须先接收完整轮次，确认所有调用及其顺序，再统一生成客户端可见响应。

### 4.3 Dispatcher 的实际处理顺序

`MemoryProxy/src/native-proxy-tools/native-proxy-tool-dispatcher.ts::execute()` 依次完成：

1. 检查工具是否归 MemoryProxy；
2. 处理无效 JSON；
3. 调用 Registry 的校验函数；
4. 交给 Memory、Skill 或 Knowledge executor；
5. 把 Bridge 状态和返回信封整理成统一 Tool Result；
6. 对过大结果返回有界的 `result_too_large` 对象。

当前默认限制来自 `MemoryProxy/src/config.ts`：

| 配置 | 默认值 | 作用 |
|---|---:|---|
| `toolTimeoutMs` | 20 秒 | 一次调用及其重试共用的最长时间 |
| 只读调用尝试次数 | 最多 2 次 | 只对异常、408、429 和 5xx 再试一次 |
| 修改和归档调用尝试次数 | 1 次 | 避免自动重试造成重复修改 |
| `maxCallsPerRound` | 8 | 一次模型输出允许的 Native Tool 数量 |
| `maxTotalCalls` | 20 | 一次用户请求经过多次模型续写后的累计数量 |
| `maxRounds` | 5 | 最多请求模型的轮数 |
| `maxResultBytes` | 65,536 字节 | 按 JSON 序列化后的 UTF-8 大小限制结果 |
| `stateTtlSeconds` | 1,800 秒 | 未完成调用及重复请求状态的默认保存时间 |

### 4.4 没有工具和只有 Native Tool 时

- 没有 Native Tool：外部第一轮直接回放上游响应；普通 Client Tool 由客户端按原协议执行。
- 只有 Native Tool：MemoryProxy 等结果全部写入短期状态，恢复完整 Assistant Tool Call 和按顺序排列的 Tool Result，先保存长期记录，再使用首次请求的上游目标继续请求模型，直到得到最终回答或达到限制。

内部再次请求模型由 `exact-target-transport.ts` 完成。它复用首次请求已经确定的模型、URL、协议、System、Tools 和允许保存的参数，不重新跑会话初始化、注入和模型选择，也不会把 API Key 写入 ClickHouse。

## 5. Native Tool 与 Claude Code Client Tool 混合调用

一次 Assistant 输出可以是：

```text
文本 → Native Tool A → thinking → Read → Native Tool B
```

Parser 为每个 Tool Call 保存模型给出的调用 ID，并记录它在 Assistant 内容中的位置。`ToolExecutionContext.assistantSkeleton` 保存原始 Assistant 结构；`slots` 保存每个调用的 ID、名称、执行方、位置、参数、状态和结果。相同工具名可以出现多次，因为结果按调用 ID 关联，而不是按名称关联。

轮末处理分为两部分：

1. Native Tool 由 MemoryProxy 执行；
2. `Read`、`Bash` 等 Client Tool 留给 Claude Code。

向 Claude Code 返回响应前，`anthropic-response-rebuilder.ts`、`openai-response-rebuilder.ts` 或 `responses-response-rebuilder.ts` 按已经解析出的 block/output index 删除 Native Tool 的完整事件，并重新编号剩余内容。它不靠名称或字符串替换，因此不会误删同名工具，也不会破坏文本、thinking 或协议原有事件。发送前还会检查 Native 工具名、调用 ID 和参数是否残留。

Claude Code 完成客户端工具后，在下一次 HTTP 请求中提交 Tool Result。`client-tool-resume.ts::resumeClientToolResults()` 会：

1. 按每个 `tool_use_id` / `tool_call_id` 找到同一组短期状态；
2. 要求本次请求完整返回此前下发的所有 Client Tool Result；
3. 拒绝未知 ID、跨组结果、缺失结果和内容冲突的重复提交；
4. 等待仍在运行的 Native Tool；原进程退出时，可在原执行权过期后接手未完成调用；
5. 按 Assistant 原位置恢复完整 Tool Call，再按相同调用顺序组成 Tool Result；
6. 先写入长期 Tool Ledger，再固定原上游目标继续请求模型。

相同结果重复提交时，系统返回已经保存的响应字节；相同 ID 但内容不同则返回冲突。内部续写再次产生客户端工具时，父调用状态还会保存子状态主键和已返回响应，减少进程中断造成的重复下发。

## 6. 短期 Runtime State 与长期 Tool Ledger

两类数据解决的是不同问题，当前代码没有把它们混在一张表中。

| 数据 | 主要文件/表 | 保存内容 | 生命周期 |
|---|---|---|---|
| 短期运行状态 | `ToolExecutionContext`；`native_proxy_tool_execution_state` | Assistant 原结构、每个调用状态和结果、限时执行权、客户端下发状态、再次请求模型的状态、响应快照、无凭据上游快照 | 默认 1,800 秒，表使用 `TTL expires_at DELETE` |
| 长期工具记录 | `NativeToolLedgerRound`；`native_proxy_tool_ledger` | 当前轮次中隐藏的 Native Tool、定位混合调用所需的 Client Tool 引用、纯 Native 轮的隐藏文本/thinking、模型实际收到的受限结果 | 当前 DDL 没有 TTL |
| 会话事件 | `native_proxy_tool_context_event` | UserPromptSubmit、PreCompact、PostCompact 和压缩错误 | 当前 DDL 没有 TTL |

### 6.1 短期状态

`ToolExecutionStorageAdapter` 定义了创建、按调用 ID 查询、保存流式进度、认领执行、保存结果、认领模型续写以及重复响应回放等操作。ClickHouse 实现位于 `clickhouse-tool-execution-storage-adapter.ts`。

并发更新使用 `revision` 和 `mutation_token` 做带版本号的条件更新：只有读到的版本仍是最新版本时才接纳修改，更新后再回读核对。执行 Native Tool 前，某个实例先取得该调用一段有限时间的执行权；其他实例不能同时执行。实例退出且结果未保存时，执行权过期后可以接手。这个机制避免大部分重复执行，但不能让外部业务系统获得严格的分布式 exactly-once；因此修改类工具仍只尝试一次。

短期状态还限制单个参数/结果 1 MiB、Assistant 结构 2 MiB、上游快照和续写响应各 4 MiB、整条状态 8 MiB。上游快照只保存允许字段和目标标识，不保存请求凭据。

### 6.2 长期 Tool Ledger

`NativeToolLedgerStorageAdapter` 和 `ClickHouseNativeToolLedgerStorageAdapter` 保存已经完成的隐藏历史。纯 Native 轮在再次请求模型前由 `ToolLoopExecutionCore.persistCompletedHistory()` 写入；混合轮在收到全部客户端结果后由 `resumeClientToolResults()` 写入。写入失败返回 503，不能带着历史缺口继续请求模型。

`ledgerId` 来自短期状态主键。同一 ID 重复写入相同内容直接复用，内容不同则报冲突。长期记录保存的是经过结果大小限制、实际交给模型的内容，不保存 Bridge 未截断的原始响应。

当前代码与 `MemoryProxy/README_CN.md` 有一处明确不一致：README 写“隐藏历史默认保留 30 天”，但配置中没有长期历史 TTL，两个长期表的 DDL 也没有 `TTL`。代码实际是无限期保存，除非运维侧另行清理。这既是文档错误，也是存储会持续增长的技术债务。

## 7. 跨请求透明历史恢复

### 7.1 为什么需要恢复

Claude Code 只保存自己看到的消息。若第一轮模型调用了 Native Tool，Claude Code 通常只留下用户问题和最终回答；下一轮直接转发这份历史时，上游模型会看不到之前的 Tool Call 与 Tool Result。要让 MemoryProxy 的存在不改变模型历史，Proxy 必须把这部分内容补回原来的用户轮次。

### 7.2 用户轮次如何确定

当前实现没有再从 `role=user` 消息猜测哪些是用户问题，而是使用 Claude Code 官方 `UserPromptSubmit` Hook：

1. `claude-context-hooks.ts::applyClaudeContextHook()` 调用长期存储的 `recordUserPrompt()`；
2. ClickHouse 追加一条 `user_prompt` 事件，生成递增 `turnSeq` 和随机 `turnToken`；
3. Hook 通过 `additionalContext` 返回 `<tdai-native-turn token="..."/>`；
4. `turn-marker.ts::extractClaudeTurnMarkers()` 在请求进入业务流程时取出标记并从模型输入删除。

因此，Client Tool Result、Native Tool 内部续写、Claude Code reminder 和压缩内部请求都不会自行增加 `turnSeq`。内置 `/compact` 即使触发 `UserPromptSubmit`，也会被明确排除。

### 7.3 当前怎样把历史补回去

每条长期记录使用四层顺序：压缩代次 `contextEpoch`、用户轮次 `turnSeq`、模型续写轮数 `round`、Assistant 内容位置 `blockIndex`。Tool Call 与 Result 再由调用 ID 对应。

`tool-history-reconstructor.ts::materializeClaudeToolLedgerHistory()` 在每个非 WebSearch 辅助的 Claude Code 请求发给上游前执行：

1. 从客户端消息中取出当前 Session 的用户轮次标记；
2. 查询当前压缩代次的 Tool Ledger；
3. 若某一轮只有 Native Tool，就在该用户问题后插入隐藏的 Assistant 消息和 User Tool Result；
4. 若 Native Tool 与 Client Tool 混合，就用 Client Tool 调用 ID 在 Claude Code 现有历史中找到那条 Assistant 和结果消息，只补入缺少的 Native block，再按原 `blockIndex` 排列全部结果；
5. 按用户轮次从后往前处理，避免前面的插入改变后面已经确定的位置。

系统不保存 Claude Code 的整份对话，也不使用整段消息 Hash。Client Tool 引用只用于定位 Claude Code 已经保存的可见部分，避免把 `Read` 和它的结果重复插入。如果标记缺失、Client Tool ID 不一致、结果不存在或历史已经改写到无法对应，系统返回 409，不猜测位置。

这套长期恢复目前只接在 `anthropicHandler.ts`，也就是 Claude Code 的 Anthropic 客户端入口。Chat Completions 和原生 Responses 客户端有短期混合工具恢复，但没有 Hook 驱动的跨用户轮次 Tool Ledger 恢复。

## 8. Context Compression 适配

当前压缩处理的核心不是识别摘要提示词，而是用 Claude Code 官方 Hook 明确划分压缩前后。

安装脚本 `MemoryProxy/scripts/setup-claude-code.sh` 会在 Claude Code `settings.json` 中合并三个带鉴权头的 HTTP Hook：`UserPromptSubmit`、`PreCompact` 和 `PostCompact`，并保留用户已有 Hook。服务端入口是 `POST .../hooks/claude-code/context`，由 `routes/claude-context-hook.ts` 完成身份校验。

一次正常压缩的处理顺序如下：

```text
PreCompact
  → 追加 compact_pending，目标为 currentEpoch + 1
  → currentEpoch 暂时不变

Claude Code 发出摘要请求
  → 仍按普通请求执行历史恢复
  → 查询旧 Epoch，把尚未压缩的 Native Tool 历史完整交给摘要模型

摘要成功，PostCompact
  → 追加 compact_completed
  → currentEpoch 切换到目标 Epoch

压缩后的下一次请求
  → 只查询新 Epoch
  → 旧 Native Tool 历史不再补入，因为它已经交给摘要模型处理
```

普通用户请求、Client Tool Result 和摘要请求共用同一个 `materializeClaudeToolLedgerHistory()`，没有第二套“压缩历史恢复算法”。MemoryProxy 只保证送入摘要模型的上下文包含客户端看不到的 Native Tool 历史；摘要最终保留哪些信息由模型决定，这与 Claude Code 直接连接模型时相同。

当前代码不再保存摘要内容 Hash，也不判断固定英文摘要指令，不维护 Compression Receipt 或 Checkpoint。压缩代次由追加的 `compact_pending` / `compact_completed` 事件计算。

这套简化方案有明确前提：三个 HTTP Hook 必须按正常顺序送达。Hook 请求失败不会阻止 Claude Code 继续运行，因此可能出现：

- `UserPromptSubmit` 丢失：下一次请求缺少最新轮次标记，历史恢复返回 409；
- `PreCompact` 丢失但 `PostCompact` 到达：写入 `compact_error`，后续恢复停止；
- `PreCompact` 和 `PostCompact` 都丢失：Claude Code 已压缩，但 Proxy 仍停在旧 Epoch；
- 同一 `PostCompact` 在完成后重复到达：由于没有官方 compact ID，当前代码会把第二次事件视为 `post_without_pending`，并写入 `compact_error`。

上述情况是当前第一版的可靠性边界，不应在文档中写成“任意乱序或重试都幂等”。Codex 的 `/responses/compact` 和 WorkBuddy 同名辅助端点目前是 Responses 辅助请求透传，不使用这套 Claude Hook/Tool Ledger 机制。

## 9. 多协议适配

### 9.1 实际支持矩阵

| 客户端协议 | 上游协议 | Native Tool Loop | 跨用户轮次隐藏历史恢复 |
|---|---|---|---|
| Claude Code / Anthropic Messages | Anthropic Messages | 已实现 | 已实现 |
| Claude Code / Anthropic Messages | OpenAI Responses | 已实现，请求与响应双向转换 | 已实现，长期记录统一保存为 Claude 可恢复的 Anthropic 结构 |
| OpenAI-compatible Chat Completions | Chat Completions | 已实现 | 未接入 Tool Ledger/Hooks |
| Codex、WorkBuddy / OpenAI Responses | OpenAI Responses | 已实现 | 未接入 Tool Ledger/Hooks |

当前不是任意客户端协议到任意上游协议的全互转。Chat 主要连接 Chat-compatible 上游；原生 Responses 主要连接 Responses 上游；唯一明确实现的跨协议路径是 Anthropic 客户端到 Responses 上游。

### 9.2 共用部分与协议专用部分

共用部分包括：

- `ProtocolAdapter` 对请求中的消息、System、Tools 做注入层解析和序列化；
- `UnifiedToolCall` 统一调用 ID、名称、执行方、位置和参数；
- `ToolExecutionContext`、`ToolCallSlot`、`ToolLoopExecutionCore` 共用调用限制、持久化、限时执行权、结果接纳和客户端下发状态；
- Registry、Dispatcher 和三类 Bridge executor 与 wire 协议无关。

仍与协议相关的部分包括：

- SSE Parser；
- Assistant 原结构和 Tool Result 的重建；
- Native 事件过滤及剩余事件重新编号；
- 结束事件、错误事件和用量映射；
- 各 Handler 的请求准备和返回格式。

最终代码没有采用一个覆盖所有协议的巨型 Coordinator。Anthropic 使用 `AnthropicToolLoopCoordinator`；Chat 和 Responses 共用 `OpenAIToolLoopCoordinator` 的控制流程，但各自提供 Parser、Assistant 结构、结果构造和客户端响应过滤方法。这个分法保留了协议差异，同时复用真正相同的执行规则。

### 9.3 Anthropic 与 Responses 的双向转换

`protocol-bridge/anthropic-responses-request.ts` 把已经完成注入和历史恢复的 Anthropic 请求转换为 Responses：

- `system` → `instructions`；
- User/Assistant 文本和图片 → Responses message item；
- `tool_use` → `function_call`；
- `tool_result` → `function_call_output`；
- Anthropic Tool Schema 的 `input_schema` → Responses 的 `parameters`；
- thinking → reasoning。

`protocol-bridge/responses-anthropic-response.ts` 再把 Responses SSE 转回 Claude Code 需要的 `message_start`、content block、`input_json_delta`、`content_block_stop`、`message_stop` 等事件。调用关联使用 Responses `call_id` 和 Anthropic `tool_use.id` 的同一个值。

无法等价表示的字段不会被静默删除。例如 Anthropic `stop_sequences`、`top_k` 或无法映射的 Responses output item 会直接报错。协议自己的 Provider Tool 在同协议下可以原样保留，但任意 Provider Tool 跨 Anthropic/Responses 并不保证可转换。

## 10. 关键工程问题及最终处理方式

### 10.1 从 curl 文本变成真正的模型工具

问题不只是添加 Schema，还要让 MemoryProxy 接管执行。最终把工具名、参数、归属、后端和副作用统一放进 Registry；Injector 只负责把可用定义交给模型，Dispatcher 负责执行。旧 curl、URL 和鉴权说明被删除。

### 10.2 参数分段到达

Tool Call 参数可能在任意 UTF-8/SSE 分片处断开。最终 Parser 按协议事件累积，只有收到协议定义的完成边界才生成可执行调用；Chat 因缺少单调用完成信号，保守等到轮末。

### 10.3 Native 与客户端工具完成顺序不同

模型生成顺序、Native 实际完成顺序和 Claude Code 返回结果的时间互不相同。最终用调用 ID 负责结果对应，用 `contentBlockIndex` 保留 Assistant 位置，用 `slotIndex` 生成结果顺序，并保存 Assistant 原结构。客户端只收到过滤后的可见部分。

### 10.4 Client Tool Result 跨 HTTP 请求返回

混合调用不能依赖进程内 Promise。最终先将整组调用写入 ClickHouse，再下发 Client Tool；下一次请求按调用 ID 找回状态，检查结果是否完整，等待或接手 Native 调用，最后继续请求原模型。重复请求返回已保存字节，冲突请求停止处理。

### 10.5 隐藏 Native Tool 后，上游历史出现缺口

早期方案用整段消息摘要值寻找插入位置，Claude Code 加入或调整 reminder 后就可能匹配失败，而且压缩处理越来越复杂。最终删除该方案，改用官方 `UserPromptSubmit` 明确记录用户轮次，用 `turnSeq + round + blockIndex + callId` 保存最少历史；恢复时以 Claude Code 已有 Client Tool ID 定位混合轮。

### 10.6 Context Compression

最终不再分析压缩提示词。PreCompact 让摘要请求仍读取旧 Epoch，PostCompact 在摘要完成后切换 Epoch。这样摘要请求与普通请求使用同一个历史恢复函数，旧记录也不会在压缩后重复加入。

### 10.7 内部再次请求模型不能改变目标

如果再次经过普通模型选择，Tool Result 可能被送到另一个模型或不同服务。最终保存无凭据目标信息，同进程复用首次成功请求的 Header，重启后只在当前可信配置能精确还原同一目标时继续；否则返回 503。

### 10.8 多实例下避免重复执行

短期状态使用带版本号的更新和有限时间执行权，只有取得执行权的实例可以保存对应结果。外部修改类接口仍无法提供严格事务级 exactly-once，所以当前不自动重试写/archive 操作，这是可靠性与可用性之间的保守选择。

## 11. 当前实现边界和技术债务

以下均来自当前代码，不是未来设想。

### 11.1 已经实现并有测试覆盖

- 18 个 Memory/Skill/Knowledge Native Tool 的显示条件、Schema 和校验；
- Anthropic、Chat、Responses 的增量解析、纯 Native Tool、普通客户端工具和常见混合调用；
- 只读提前执行，修改类轮末执行，超时、读重试、结果大小和调用次数限制；
- 未知、重复、缺失、跨会话 Client Tool Result 的拒绝与相同结果回放；
- ClickHouse 短期状态的版本更新、执行和模型续写认领、过期恢复、响应快照；
- Claude Code Hook、用户轮次标记、纯 Native/混合历史恢复和压缩代次切换；
- Anthropic 客户端连接 Anthropic 或 Responses 上游；
- Native Tool 事件过滤与客户端输出检查。

本次审查在 `MemoryProxy` 中重新执行了验证：`npm run typecheck` 通过；常规 `npm test` 为 415 项通过、7 项按环境开关跳过。随后连接本机真实 ClickHouse，显式开启并单独运行这 7 项，结果全部通过。`setup-claude-code-hooks.test.sh` 和 `claude-native-batch.test.sh` 也执行成功。这里的 HTTP 集成测试使用受控上游，并不等同于真实外部 DeepSeek 的持续在线测试。

### 11.2 明确的未支持场景

1. `/branch`、`/fork` 创建的新 Session 不继承父 Session 的 Native Tool Ledger。新 Session ID 能避免互相污染，但父会话中隐藏的工具历史不会自动复制。
2. Chat Completions 和原生 Responses 客户端尚无跨用户轮次的长期隐藏历史恢复；只支持当前工具调用过程的短期续接。
3. `stream=false` 时不会注入或执行新的 Native Tool。Claude Anthropic 入口可以读取长期历史，但不能开始新的 Native Tool Loop。
4. 不支持任意协议两两转换，也不保证 Provider Server Tool 跨协议无损。
5. 重启后无法恢复来源为 `extension` 的临时凭据；模型、URL 或鉴权配置改变时也不会改投其他目标。
6. 外部 Memory/Skill/Knowledge 服务没有参与分布式事务，修改类调用不能承诺严格 exactly-once。

### 11.3 需要后续单独处理的问题

1. **Hook 交付与幂等**：`recordUserPrompt()` 当前通过“查询最大 turnSeq 再加一”写事件，HTTP 重试或并发提交没有官方事件 ID，可产生额外轮次或相同序号。重复/迟到的 PostCompact 会写 `compact_error`；而 `getSessionContext()` 只要看到任何历史 `compact_error`，以后都停止恢复。
2. **长期表没有清理策略**：代码没有 README 所说的 30 天 TTL，Tool Ledger 和 Hook 事件会持续增长。
3. **Memory session_id 含义不一致**：Schema 允许指定历史 session，Memory Bridge 却覆盖为当前会话。
4. **Responses 的结果顺序依赖完成事件顺序**：`ResponsesStreamParser.completeCall()` 以完成先后分配 `slotIndex`，而 Assistant 结构按 `output_index` 排列。若上游允许多个函数调用乱序完成，Tool Result 顺序可能与模型原始顺序不一致。Anthropic Parser 也在 block stop 时分配 slot，依赖正常的 block 生命周期顺序。
5. **OpenAI-family 内部纯 Client 轮处理弱于 Anthropic**：模型内部续写后若只产生 Client Tool，`OpenAIToolLoopCoordinator` 直接作为 final/replay 返回，没有建立 Anthropic 对等的短期客户端续接状态；原生 Responses 客户端尤其可能丢失前一轮隐藏 Native 历史。
6. **长期写入的并发保证有限**：`appendRound()` 通过读前检查、写后回读保证常规幂等，但 ReplacingMergeTree 不是唯一键事务；多个实例同时首次写同一 ID 的冲突窗口仍值得增加真实并发测试。
7. **Hook HTTP 失败不阻止 Claude Code**：安装脚本可以自动配置 Hook，但不能改变 Claude Code 对 HTTP Hook 失败的非阻塞处理。这是当前透明历史恢复最重要的运行条件。

这些问题不在本次“只补注释和重写文档”的范围内，本次没有修改业务行为。

## 12. 关键代码索引

| 文件 | 核心类/函数 | 职责 |
|---|---|---|
| `MemoryProxy/src/native-proxy-tools/tool-registry.ts` | `NativeProxyToolDefinition`、`createDefaultNativeProxyToolRegistry()` | 18 个工具的 Schema、显示条件、归属、Bridge 路径和校验 |
| `MemoryProxy/src/native-proxy-tools/native-proxy-tools-injector.ts` | `NativeProxyToolsInjector.execute()` | 按会话和能力注入 Tool Schema，拒绝名称冲突 |
| `MemoryProxy/src/injection/index.ts` | `buildPipelineBundle()` | 注册三种协议 Adapter、动态上下文和 Native Injector；不再注册 Fake Tool Injector |
| `MemoryProxy/src/injection/adapters/anthropic-stream.ts` | `AnthropicStreamParser` | 解析 Anthropic block 和增量 JSON 参数 |
| `MemoryProxy/src/injection/adapters/openai-stream.ts` | `OpenAIStreamParser` | 在 Chat 轮末恢复 function calls |
| `MemoryProxy/src/injection/adapters/responses-stream.ts` | `ResponsesStreamParser` | 解析 Responses output item 和参数完成事件 |
| `MemoryProxy/src/native-proxy-tools/tool-loop-execution-core.ts` | `ToolLoopExecutionCore` | 三种协议共用的调用限制、短期保存、执行权和结果接纳 |
| `MemoryProxy/src/native-proxy-tools/tool-loop-coordinator.ts` | `AnthropicToolLoopCoordinator` | Anthropic SSE 消费、提前执行、客户端下发和内部续写 |
| `MemoryProxy/src/native-proxy-tools/openai-tool-loop-coordinator.ts` | `OpenAIToolLoopCoordinator` | Chat/Responses 共用的轮次控制 |
| `MemoryProxy/src/native-proxy-tools/anthropic-client-responses-tool-loop.ts` | `AnthropicClientResponsesToolLoopCoordinator` | Responses 上游与 Anthropic 客户端之间的 Tool Loop 边界 |
| `MemoryProxy/src/native-proxy-tools/native-proxy-tool-dispatcher.ts` | `NativeProxyToolDispatcher.execute()` | 参数校验、超时、重试、Bridge 错误和结果大小处理 |
| `MemoryProxy/src/native-proxy-tools/bridge-tool-executors.ts` | `createBridgeToolExecutors()` | 把 Registry backend 分派到 Memory、Skill、Knowledge executor |
| `MemoryProxy/src/memory/memory-bridge.ts` | `executeMemoryBridge()` | 可信身份、Memory 只读接口和多资产查询 |
| `MemoryProxy/src/skill/skill-bridge.ts` | `executeSkillBridge()` | 复用 Skill Handler 的权限、版本和读写行为 |
| `MemoryProxy/src/knowledge/knowledge-tool-executor.ts` | `executeKnowledgeTool()` | 重新核验 Agent 资源权限、动态工具清单和参数后调用 Knowledge Provider |
| `MemoryProxy/src/native-proxy-tools/types.ts` | `ToolExecutionContext`、`NativeToolLedgerRound` | 短期运行状态和长期隐藏历史的数据结构 |
| `MemoryProxy/src/db/clickhouse-tool-execution-storage-adapter.ts` | `ClickHouseToolExecutionStorageAdapter` | 短期状态 TTL、带版本更新、执行/续写认领和能力探测 |
| `MemoryProxy/src/db/clickhouse-native-tool-ledger-storage-adapter.ts` | `ClickHouseNativeToolLedgerStorageAdapter` | 长期 Tool Ledger 与 Hook 事件的追加和查询 |
| `MemoryProxy/src/native-proxy-tools/client-tool-resume.ts` | `resumeClientToolResults()` | 接收客户端结果、恢复未完成 Native 调用并继续请求模型 |
| `MemoryProxy/src/native-proxy-tools/tool-ledger-round.ts` | `buildNativeToolLedgerRound()` | 把已完成短期状态收敛成最少长期记录 |
| `MemoryProxy/src/native-proxy-tools/tool-history-reconstructor.ts` | `materializeClaudeToolLedgerHistory()` | 按 Turn、Round、Block 和调用 ID 补回 Claude 隐藏历史 |
| `MemoryProxy/src/native-proxy-tools/turn-marker.ts` | `extractClaudeTurnMarkers()` | 读取并删除 UserPromptSubmit 位置标记，保留其他 reminder |
| `MemoryProxy/src/native-proxy-tools/claude-context-hooks.ts` | `applyClaudeContextHook()` | 处理 UserPromptSubmit、PreCompact、PostCompact |
| `MemoryProxy/src/routes/claude-context-hook.ts` | `handleClaudeContextHook()` | 鉴权后的 Hook HTTP 入口 |
| `MemoryProxy/scripts/setup-claude-code.sh` | 安装/卸载逻辑 | 自动合并 Proxy 环境变量和三个 Claude Hook |
| `MemoryProxy/src/native-proxy-tools/exact-target-transport.ts` | `buildUpstreamRequestSnapshot()`、两种 exact transport | 保存无凭据请求快照，并在内部续写时固定原上游 |
| `MemoryProxy/src/native-proxy-tools/*-response-rebuilder.ts` | 各协议重建函数 | 隐藏 Native 事件、重排可见事件并构造 Tool Result |
| `MemoryProxy/src/protocol-bridge/anthropic-responses-request.ts` | `convertAnthropicRequestToResponses()` | Anthropic 请求转换为 Responses |
| `MemoryProxy/src/protocol-bridge/responses-anthropic-response.ts` | `createResponsesToAnthropicSseTransform()` | Responses 流转换为 Claude Code 可用的 Anthropic 流 |
| `MemoryProxy/src/anthropicHandler.ts` | `handleAnthropicMessages()` | Claude Code 主入口，接入会话、注入、恢复、协议转换和 Tool Loop |
| `MemoryProxy/src/native-proxy-tools/responses-handler-runtime.ts` | `runResponsesNativeToolLoop()`、`resumeResponsesNativeToolLoop()` | Codex/WorkBuddy Responses 入口的短期 Native Tool 处理 |

## 结论

当前 Native 项目已经把原来的 Fake Tool/curl 提示改造成真正的模型工具：MemoryProxy 可以在三个协议中识别和执行 Native Tool，处理常见的 Native/Client 混合调用，并用 ClickHouse 保存未完成状态。Claude Code 路径进一步通过官方 Hooks、用户轮次标记和长期 Tool Ledger，把客户端看不到的 Native Tool 历史补回后续上游请求，并让压缩请求自然使用同一恢复过程。

最终方案比早期的整段历史摘要值方案简单：它不保存客户端全部对话，不猜 compact 提示词，也没有额外 Receipt/Checkpoint。不过，这份简化依赖 Hook 正常送达；跨用户轮次恢复目前仅完整支持 Claude Code Anthropic 入口，长期表也缺少实际 TTL。上述边界应在后续可靠性改进和 A/B 评测前分别处理，不能在实验报告中写成已经解决。
