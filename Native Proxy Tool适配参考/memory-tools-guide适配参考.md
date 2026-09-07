# `<memory-tools-guide>` 的 Native Proxy Tool 适配参考

> 状态：初稿，仅供分析与首轮实现参考
>
> 更新时间：2026-08-30
>
> 源码快照：Baseline `41306b1dd64b`；Native `67288102d1e5`
>
> 重要说明：本文给出的 Prompt 和 Tool Description 不是最终版本。真正实现时可以根据实际工具集合、Provider 协议行为和 A/B 评测结果继续修改、合并，甚至完全删除候选 System Prompt。

## 1. 分析对象与边界

本文分析的是 MemoryProxy 中由 `tdai-profile-memory-injector` 注入的 `<memory-tools-guide>`：

- [Fake Tool 对照定义（Baseline）](../TencentDB-Agent-Memory-Baseline/MemoryProxy/src/injection/injectors/tdai-profile-memory-injector.ts)
- [Native 当前起点定义](../TencentDB-Agent-Memory-Native/MemoryProxy/src/injection/injectors/tdai-profile-memory-injector.ts)（仅记录分析时的起点；迁移后不作为旧实现查阅入口）
- [注入器注册逻辑](../TencentDB-Agent-Memory-Baseline/MemoryProxy/src/injection/index.ts)
- [配套的 Baseline `<tdai_memory_tools>` 定义](../TencentDB-Agent-Memory-Baseline/MemoryProxy/src/injection/injectors/tdai-tools-injector.ts)

Baseline、Native 起点和官方参考源码中的该文件当前内容一致。MemoryCore 的 auto-recall 和 OpenClaw Plugin 中也存在同名标签，但属于不同执行路径，不是本文所讨论的 MemoryProxy 注入块。

实施 Native Proxy Tool 时，Native 项目不会保留原 Fake Tool 提示、curl 调用实现、兼容开关或回退路径。需要查看旧内容、复现实验基线或进行 A/B 对照时，应直接查阅上述 Baseline 文件；本文保留旧内容分析仅用于说明迁移依据，不代表 Native 项目需要同时维护两套方案。

本文只讨论如何把这段 Fake Tool 提示适配为 Native Proxy Tool 方案，不在此处最终确定全部 Memory Native Proxy Tool Schema，也不修改 Memory、Skill 或 Knowledge 后端业务能力。

## 2. 当前真实行为

`<memory-tools-guide>` 并不是 Tool Schema，而是一段静态 System Prompt。它与 `<tdai_memory_tools>` 配合工作：

```text
<tdai_memory_tools>
  说明有哪些工具、Bridge URL、请求参数、返回结构以及 curl 调用方法

<memory-tools-guide>
  说明什么时候调用、选择哪个工具、什么时候不调用以及失败后如何回答
```

当前注入逻辑具有以下特征：

1. 注入点为 `system.suffix`，锚定在 memory 槽位内部末尾；
2. 使用 `session_init` 缓存策略，Session Init 时生成，后续请求复用；
3. 当存在 L3 Persona 或 L2 Scene Index 时，指南跟在 `</tdai_profile_memory>` 后；
4. 即使 L2/L3 内容全部为空，仍以 `tools-only` 模式注入该指南；
5. 未恢复 TDAI 身份、`chat_memory` 被关闭，或未注册 `TdaiProfileMemoryInjector` 时不注入；
6. 该指南依赖上方 `<tdai_memory_tools>` 提供真实 URL 和请求细节，本身并不完整描述所有六个 Memory 操作。

其内容实际承担五类职责：

| 当前内容 | 目的 |
| --- | --- |
| “这不是文档，这是你的可用能力” | 强化模型对 Fake Tool 的能力认知 |
| 禁止回答“没有工具、需要 MCP” | 修正模型无法识别 curl 伪工具时的拒绝行为 |
| “历史、偏好、回忆、旧约定必须先查” | 决定何时调用 Memory Tool |
| “通用编程、当前上下文已有答案时不查” | 限制误调用 |
| curl 示例、次数限制、无结果与重复读取规则 | 指导 Fake Tool 执行和结果处理 |

## 3. 为什么不能原样保留

迁移到 Native Proxy Tool 后，模型通过请求中的结构化 `tools` 数组获知工具名称、用途和参数，并产生原生 Tool Call；MemoryProxy 负责身份补充、Bridge 调用、结果回填和模型重入。因此原指南中的多项内容已经失去必要性：

- Bash、curl、Bridge URL、Header 和鉴权说明属于旧传输方式；
- “这是真实能力”“不要说需要 MCP”等文字主要用于弥补 Fake Tool 不在原生工具列表中的问题；
- 单个工具的用途和参数如果同时出现在 System Prompt 与 Tool Description 中，会形成重复维护和额外 Token；
- 调用次数、超时、结果大小和身份字段不能只依赖模型遵守，必须由 MemoryProxy 运行时强制执行；
- 过度使用“命中关键词就必须查询”可能提高调用率，但也可能显著增加负样本误调用。

原指南仍有一部分信息不能简单丢弃：模型仍需要区分 L0 原始对话、L1 原子记忆和 L2 场景正文的适用范围，也需要知道当前上下文已经足够时不应重复检索。因此，适配的关键不是“整段删除”或“整段照搬”，而是把信息放回正确的承载层。

## 4. 内容拆分与迁移建议

| 原内容 | 初步处理 | 建议承载位置 | 原因 |
| --- | --- | --- | --- |
| “这不是文档，是可用能力” | 删除 | 无 | 原生 `tools` 数组已经表达能力存在 |
| “禁止说没有工具、需要 MCP” | 删除 | 无 | 属于 Fake Tool 补丁式提示 |
| Bash、curl、Bridge URL、Header | 删除 | MemoryProxy Executor/Bridge | 模型不应感知传输与鉴权细节 |
| 每个工具的用途和输入 | 迁移并精简 | 对应 Tool Description 与 JSON Schema | 让工具定义成为单一事实来源 |
| 历史事实、偏好、原文、场景的选择规则 | 压缩保留 | Tool Description；必要时增加极短的跨工具策略 | 这是 Tool Selection 所需信息 |
| 当前上下文或已注入画像足够时不查询 | 保留 | 精简的跨工具策略 | 用于控制误调用 |
| 检索无果时不得编造 | 保留并结构化 | Tool Result 语义 + 极短行为规则 | 保证回答基于实际结果 |
| 搜索合计不超过 3 次 | 从提示词移出 | Tool Loop Coordinator 配置 | 必须由运行时可靠执行 |
| 同一路径不要重复读取 | 以运行时为主 | Coordinator 去重/循环限制；策略中可简短提醒 | 不能仅依赖模型自律 |
| L3/L2 已直接注入 | 条件保留 | 动态上下文或精简策略 | 只有实际仍注入时才成立 |

## 5. 初步适配结果

### 5.1 推荐的信息分布

```text
tools[]
  ├─ 每个工具的名称、用途、适用信息层级和参数 Schema
  └─ 能由 Tool Description 独立表达的选择条件

精简 System Policy（可选）
  └─ 只保存跨工具选择、避免误调用和无结果处理规则

MemoryProxy Runtime
  ├─ 身份与鉴权注入
  ├─ 调用次数、轮数、超时和结果大小限制
  ├─ 重复调用与循环保护
  └─ Tool Result 回填及错误结构化
```

首轮实现不应直接假设必须保留新的 System Policy。可以同时准备“仅 Tool Schema”和“Tool Schema + 极短策略”两个实验版本，通过 Tool Calling Decision / Tool Selection 指标决定是否保留策略块。

### 5.2 候选精简策略块

以下内容是从旧 `<memory-tools-guide>` 中提取的最小候选版本，仅供实现和实验参考：

```text
<tdai_memory_tool_policy>
仅当回答依赖当前上下文之外的持久化历史信息时，使用 TDAI Memory 工具：
- 查找用户偏好、身份、规则或历史结论，使用 tdai_memory_search；
- 查找过去对话的具体原文、时间线或上下文细节，使用 tdai_conversation_search；
- 已从场景索引定位路径且需要完整场景内容时，使用 tdai_read_scene。

如果当前会话或已注入的长期画像已经足以回答，不要重复查询；普通编程任务不因出现“记忆”等字样自动触发工具。回答必须以实际查询结果为依据；未找到时明确说明未找到，不要推测或补造。避免重复执行等价搜索或读取同一路径。
</tdai_memory_tool_policy>
```

与原块相比，该版本有意删除：

- 所有 Bash、curl、URL、Header 和鉴权内容；
- “这不是文档”“禁止说需要 MCP”等能力强化话术；
- 可由 Tool Description 表达的完整工具清单和请求示例；
- 需要由 Coordinator 强制执行的具体次数上限。

这段策略也不一定要以 XML 标签存在。最终可以按现有 Injection Pipeline 的结构约定改为普通短文本，或在实验证明 Tool Description 已经足够时完全取消。

### 5.3 候选 Tool Description

以下只展示工具用途描述，不代表最终名称、参数 Schema 或完整工具集合：

| 工具 | 候选 Description |
| --- | --- |
| `tdai_memory_search` | 搜索持久化的 L1 原子记忆，用于查找当前上下文之外的用户偏好、身份事实、历史结论、规则和项目约定。不要用于已经能从当前会话或已注入画像直接回答的内容。 |
| `tdai_conversation_search` | 在 L0 原始对话中进行语义检索，用于寻找过去消息的具体原文、时间线或上下文细节；如果只需要稳定偏好或已提炼结论，优先使用 `tdai_memory_search`。 |
| `tdai_atomic_query` | 按已知记忆类型、时间范围和分页条件读取 L1 记录，不执行语义搜索；只有已经知道过滤条件时使用。 |
| `tdai_conversation_query` | 按已知 Session 顺序读取 L0 历史消息；需要跨对话语义查找时使用 `tdai_conversation_search`。 |
| `tdai_scenario_ls` | 列出 L2 场景路径及摘要。已注入的场景索引不足、需要刷新或按前缀筛选时使用。 |
| `tdai_read_scene` | 读取一个已知 L2 场景路径的完整内容。路径必须来自已注入索引或 `tdai_scenario_ls` 的实际结果，不得凭空构造。 |

Tool Description 应说明“何时使用”和与相邻工具的差异；字段类型、必填项、范围、默认值和未知字段策略应进入 JSON Schema，而不是继续堆在 Description 中。

## 6. 实现时需要进一步确认的事项

1. Native 首期最终注册哪些 Memory Tool，未注册工具不能残留在策略文本中；
2. L3 Persona 和 L2 Scene Index 是否继续按当前方式注入，以及不同 Agent 客户端的实际差异；
3. 工具名称是否保持当前 `tdai_*` 命名，Tool Registry 中的名称必须与 Schema、Dispatcher 完全一致；
4. 搜索次数限制是按用户轮次、模型重入轮次还是整个 Tool Batch 计算；
5. 无结果、权限错误、参数错误和上游异常的 Tool Result 结构；
6. 当 Skill、Knowledge Tool 同时加入后，是否需要把本候选块合并为统一的跨工具选择策略，避免再次出现多块重复说明；
7. Anthropic 与 OpenAI-compatible Provider 对 Tool Description 长度和选择行为是否存在显著差异。

## 7. 建议的验证方式

为了区分 Tool Schema 本身与额外策略提示的贡献，Native 方案可以至少比较两个候选版本：

| 版本 | 工具表达方式 | 目的 |
| --- | --- | --- |
| Native-A | 仅 Native Proxy Tool Schema/Description | 验证原生工具定义是否已经提供最小充分信息 |
| Native-B | Native Proxy Tool Schema/Description + 候选精简策略 | 验证跨工具规则能否提高有效调用与选择正确率，同时不显著增加误调用和 Token |

两者使用相同模型、参数、工具集合、数据资产和评测 Case，主要比较：

- Effective Tool Call Rate；
- False Tool Call Rate；
- Tool Selection Accuracy；
- 工具定义及额外策略占用的 Token。

工具返回资产质量和最终 Coding Task 成功率仍可完整记录，用于失败归因和辅助观察，但不作为这项 Tool Calling Decision / Tool Selection 评测的核心指标。

## 8. 当前建议

当前最稳妥的首轮方向是：

1. Native 项目彻底删除原 `<memory-tools-guide>` 和 `<tdai_memory_tools>` 的 Fake Tool/curl 内容，不保留旧实现的兼容开关或回退路径；需要对照时直接查阅 Baseline；
2. 先让 Tool Description 承担单工具用途和选择边界；
3. 将次数、权限、超时、重试、结果大小和身份注入交给 MemoryProxy 强制执行；
4. 将本文件中的 `<tdai_memory_tool_policy>` 作为可选实验候选，而不是预先认定的最终注入；
5. 后续结合 Skill、Knowledge 分析形成统一工具选择视图，再通过 A/B 数据确定最终 Prompt 和 Tool Description。

本文只提供适配思路和候选文本。后续真正实现时，应以当前源码、实际注册工具、协议测试和评测结果为依据进一步修改。
