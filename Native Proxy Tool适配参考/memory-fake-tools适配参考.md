# Memory Fake Tool 的 Native Proxy Tool 适配参考

> 状态：初稿，仅供首轮实现与 A/B 评测参考
>
> 更新时间：2026-08-30
>
> 重要说明：本文不是最终接口规范。Tool Description、Schema、结果结构及限制参数可根据实际实现和评测结果继续调整。

## 1. 核心结论

首版保留现有六个 Memory 业务操作的一对一语义，但彻底移除 Fake Tool 的 Bash/curl 传输方式：模型通过结构化 Tool Schema 选择工具并生成参数，MemoryProxy 负责识别、执行、权限约束、结果回填和模型重入。

Native 项目不保留 Fake Tool 实现、兼容开关或回退路径。旧提示词和调用方式统一查阅 [Baseline 工具定义](../TencentDB-Agent-Memory-Baseline/MemoryProxy/src/injection/injectors/tdai-tools-injector.ts)。首版也不把六个工具合并为一个通用 `memory_tool`，以免同时改变工具机制与业务接口，影响 A/B 归因和 Tool Selection 评测。

## 2. 六个工具及其选择边界

| 工具 | 核心用途 | Bridge 路由后缀 |
| --- | --- | --- |
| `tdai_memory_search` | 语义检索已经提炼的偏好、身份、规则和历史结论 | `/atomic/search` |
| `tdai_atomic_query` | 按已知类型、时间等条件精确过滤原子记忆 | `/atomic/query` |
| `tdai_conversation_search` | 语义检索原始对话的具体原文、上下文和时间线 | `/conversation/search` |
| `tdai_conversation_query` | 已知 Session 时按顺序读取历史消息 | `/conversation/query` |
| `tdai_scenario_ls` | 获取场景路径和摘要索引，不读取完整正文 | `/scenario/ls` |
| `tdai_read_scene` | 已经定位场景路径后读取完整正文 | `/scenario/read` |

Tool Description 应优先说明相邻工具的差异，而不是重复接口细节：

```text
memory_search        vs conversation_search：提炼信息 vs 原始消息
atomic_query         vs memory_search：条件过滤 vs 语义检索
scenario_ls          vs read_scene：路径索引 vs 完整正文
```

## 3. 提示词职责重新分配

| Fake Tool 中的内容 | Native Proxy Tool 中的处理 |
| --- | --- |
| 六个 `<tool>` 文本块 | 改为六个原生 Tool Schema |
| 工具用途与参数说明 | 精简到 Tool Description 与 JSON Schema |
| curl、URL、Header、鉴权 | 全部删除，由 Dispatcher 和 Bridge 处理 |
| `space_id`、`conversation_id` | 从可信 Session 恢复，不暴露给模型 |
| 最终 `agent_id` | 由 Proxy 按授权资产解析和校验，不直接信任模型输入 |
| 调用次数、重试、超时、结果大小 | 由 Tool Loop Coordinator / Executor 强制执行 |
| HTTP 响应与异常栈 | 转换为稳定、精简且脱敏的 Tool Result |
| “不要说没有 MCP”、Bash/curl 示例 | 删除 |
| 跨工具选择规则 | 优先写入各工具 Description；必要时保留极短公共策略 |

当前一次 Langfuse 样本中，`<tdai_memory_tools>` 与 `<memory-tools-guide>` 合计约 `2,014 Token`。迁移后的实际降幅应在最终 Schema 确定后重新统计，不能直接以草案估算代替实验结果。公共策略的候选内容及实验方法见 [memory-tools-guide 适配参考](./memory-tools-guide适配参考.md)。

## 4. 首版执行链路

```text
Tool Registry（六个 Memory Native Proxy Tool）
        ↓
NativeProxyToolsInjector → tools.append
        ↓
Anthropic / OpenAI Protocol Adapter
        ↓
模型生成原生 Tool Call
        ↓
MemoryProxy 按工具名识别并拦截
        ↓
Dispatcher 校验参数并补充可信 Session 上下文
        ↓
Memory Bridge → MemoryCore
        ↓
标准化 Tool Result
        ↓
消息回填与 Internal Re-entry
```

请求侧已有可复用基础：Injection Pipeline 支持 `tools.append`，Anthropic 和 OpenAI Adapter 已能把内部 `AgentTool` 转换为各自协议格式。首版新增工作的重点是 Tool Registry、Dispatcher、Bridge 执行器、流式拦截以及 Tool Result 回填。

## 5. 工具定义示例
六个工具的 Description 应突出差异
工具	Description 应重点说明
tdai_memory_search	查已经提炼的偏好、身份、规则和历史结论
tdai_atomic_query	已知类型或时间条件时进行精确过滤，不做语义搜索
tdai_conversation_search	查原始对话中的具体原文、上下文和时间线
tdai_conversation_query	已知 Session 时按顺序读取历史消息
tdai_scenario_ls	查场景路径和摘要索引，不返回正文
tdai_read_scene	已经获得场景路径后读取完整正文


关键不是把用途写得很长，而是清楚表达相邻工具的区别：
memory_search       vs conversation_search
提炼后的稳定信息       原始消息与时间线

atomic_query        vs memory_search
条件过滤               语义检索

scenario_ls         vs read_scene
路径索引               完整正文
这直接服务于任务一的 Tool Selection Accuracy。
以下仅展示 `tdai_memory_search` 的候选最小定义，字段限制不是最终契约：

```json
{
  "name": "tdai_memory_search",
  "description": "搜索已经提炼的长期记忆，用于查找当前上下文之外的用户偏好、身份事实、历史结论、规则和项目约定。过去消息的具体原文或时间线应使用 tdai_conversation_search。",
  "input_schema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "query": { "type": "string", "description": "检索问题或关键词" },
      "limit": { "type": "integer", "minimum": 1, "maximum": 20, "default": 5 }
    },
    "required": ["query"]
  }
}
```

模型只生成业务参数；Tool Registry 内部保存 `owner=proxy`、执行器和 Bridge 路由等信息，这些执行细节不发送给模型。

## 6. 身份与结果边界

- URL、Header、鉴权、`user_id`、`team_id` 和最终执行身份必须由 MemoryProxy 从可信上下文补充；
- `tdai_read_scene` 最好接收由 Proxy 生成并可校验的 `source_ref` / `scene_ref`，再映射为真实 `agent_id`；首版若暂时保留 `agent_id`，Dispatcher 也必须验证其属于当前 Session 已授权的 self/imported Agent；
- Tool Result 只保留模型完成判断所需的内容、来源、数量和截断状态，不暴露内部 Header、异常栈或原始上游响应；
- 参数错误、业务错误和可恢复异常转换为带 `is_error: true` 的结构化结果；Memory 内容始终按外部数据处理，不能被当作可执行指令。

## 7. 最小代码改造

1. 删除 Native 中 `<tdai_memory_tools>` 的 Fake Tool 注入与注册，不保留旧路径；
2. 从画像注入器中移除原 `<memory-tools-guide>`，是否增加极短公共策略由实验决定；
3. 在 Tool Registry 集中定义六个工具的名称、Description、Schema、归属和 Bridge 映射；
4. 增加薄层 `tools.append` Injector，并在注入前检查与 Client Tool 是否重名；
5. Dispatcher 只接收 Schema 校验后的业务参数，补充可信身份后调用现有 Memory Bridge；
6. 使用消息骨架、有序槽位和 `call_id` 完成混合工具结果归并；模型重入复用首次请求的 `system`、`tools`、模型参数和上游路由快照。

## 8. 分阶段验证

第一轮 A/B 使用与 Fake Tool 等价的参数子集，只比较工具表达和执行机制；闭环稳定后，再单独扩展 V3 SDK 已支持的时间、类型等参数，避免把“机制收益”和“功能增强收益”混在一起。

建议比较：

- `Native-A`：仅六个 Tool Schema / Description；
- `Native-B`：六个 Tool Schema / Description + 极短公共选择策略。

核心指标为 Effective Tool Call Rate、False Tool Call Rate、Tool Selection Accuracy 和工具定义 Token；工具返回资产质量与最终任务结果可以记录用于归因，但不作为本阶段的核心评价目标。

首版的目标是完成职责分层和原生工具闭环，而不是同时重构六个 Memory API。本文中的候选文本和接口细节均可在真正实现时依据源码、协议测试和评测结果进一步修改。
