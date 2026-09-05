# `<knowledge_tools>` 的 Native Proxy Tool 适配参考

> 状态：初稿，仅供首轮实现与 A/B 评测参考
>
> 更新时间：2026-08-31
>
> 重要说明：本文只给出最小适配方向，不是最终 Tool Schema 或接口契约；实现时可根据 Knowledge Service、Provider 协议和评测结果调整。

## 1. 当前内容与性质

当前 `<knowledge_tools>` 由三部分组成：

1. **资源目录**：列出当前 Agent 已绑定的 wiki / code-graph，包括 `knowledge_id`、名称、摘要、仓库匹配信息等；
2. **选择规则**：说明何时使用 wiki、code-graph 或本地 `Read` / 搜索；
3. **Fake Tool 传输说明**：要求模型使用 Bash + curl，先调用 `/tools/list` 获取 Provider Tool，再调用 `/tools/call` 执行。

因此它不是“全部是假工具”：资源目录是真实上下文，选择规则服务于 Tool Decision；URL、Header、curl 示例和两步 HTTP 调用说明才是需要迁移的 Fake Tool 部分。

对照源码：[Baseline `knowledge-tools-injector.ts`](../TencentDB-Agent-Memory-Baseline/MemoryProxy/src/injection/injectors/knowledge-tools-injector.ts)。Native 项目不保留旧 curl 路径；需要复现旧方案时直接使用 Baseline。

## 2. 当前执行方式

```text
Session Init 获取已绑定 Knowledge 资源
        ↓
注入资源目录、选择规则和 curl 示例
        ↓
模型使用 Bash 调 /tools/list
        ↓
Knowledge Service 返回动态 Provider Tool 定义
        ↓
模型使用 Bash 调 /tools/call
        ↓
Bash 输出进入后续上下文
```

当前块以 `session_init` 策略缓存，注入 System Prompt 的 knowledge 区域；没有可用资源时不注入。

## 3. 首版适配方案

保留现有“两步自发现”业务语义，但将传输方式改为两个结构化 Native Proxy Tool：

| 候选工具 | 最小业务参数 | 作用 |
| --- | --- | --- |
| `tdai_knowledge_tools_list` | `knowledge_id` | 获取指定资源当前提供的 Provider Tool 名称、说明和参数 Schema |
| `tdai_knowledge_tool_call` | `knowledge_id`、`tool_name`、`params` | 执行由上一步实际返回的 Provider Tool |

这里的两个工具归 MemoryProxy 所有；`tools/list` 返回的 `search`、`explore`、`callers`、`read_page` 等仍属于 Knowledge Service 的动态 Provider Tool。模型不能绕过 `list` 凭空构造 Provider Tool 名称和参数。

```text
精简 Knowledge 资源目录
        ↓
两个 Native Proxy Tool Schema 注入 tools[]
        ↓
模型产生结构化 Tool Call
        ↓
MemoryProxy 校验资源权限并补充可信上下文
        ↓
Knowledge Service /tools/list 或 /tools/call
        ↓
标准化 Tool Result 回填及模型重入
```

首版不把每个资源返回的所有 Provider Tool 动态展开进顶层 `tools[]`，避免工具数量膨胀、命名冲突和动态工具集合带来的状态复杂度。

## 4. 职责重新分配

| 当前内容 | 适配后的承载位置 |
| --- | --- |
| Knowledge 名称、类型、摘要和仓库匹配信息 | 精简的资源目录 |
| wiki / code-graph / 本地源码的选择边界 | Tool Description；必要时保留极短公共策略 |
| `/tools/list`、`/tools/call` 的用途与业务参数 | 两个 Native Proxy Tool Schema |
| Service URL、Header、租户和遥测身份 | MemoryProxy Dispatcher / Executor |
| 资源授权范围 | MemoryProxy 根据当前 Session 校验 |
| curl 示例、响应信封和内部错误细节 | 删除 |
| 重试次数、超时、结果大小和循环限制 | Tool Loop Coordinator / Executor 强制执行 |
| Provider 返回结果 | 精简、脱敏且带 `is_error` 语义的 Tool Result |

模型可以从资源目录选择 `knowledge_id`，但 MemoryProxy 必须验证该 ID 属于当前 Session 已授权的 Agent 资产，不能直接信任模型输入。

## 5. 首版实施边界

- 不改变 wiki / code-graph 的后端业务能力和两步发现协议；
- 不让模型继续生成 URL、Header、身份字段或 curl；
- 不为每个 Knowledge 资源复制一套顶层工具；
- 不在 Native 项目保留 Fake Tool 兼容开关或回退路径；
- 先压缩现有长篇选择规则，是否保留额外公共策略由 A/B 评测决定；
- 评测重点仍是有效调用率、误调用率、工具选择正确率和 Token，Provider 返回资产质量仅用于归因。

本文只提供适配参考。真正实现时应以实际 Knowledge Service 契约、Tool Registry 命名、权限测试和固定数据集评测结果为准。
