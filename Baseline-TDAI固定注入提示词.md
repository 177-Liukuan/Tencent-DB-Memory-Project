# Baseline 项目：TDAI 固定注入提示词

本文按 Baseline 当前代码和运行配置整理，供人工阅读。代码版本为 `baseline/bugfix-sync` 分支的 `41306b1`。

当前运行配置启用了 `skill`、`knowledge`、`tdai-memory`，`skillRuntime.allowLlmWrite=false`。因此，下文只展示当前实际开放的四个 Skill 读取/归档工具，不展示代码中可选的 Skill 写工具。

## 阅读说明

- 下文只整理 MemoryProxy 新增到请求中的 TDAI 内容，不抄录 Claude Code 自带的 System Prompt 和客户端工具定义。
- `{{...}}` 表示运行时数据，不是固定文字，例如当前 Agent、Task、会话、记忆、Skill 和 Knowledge 资源。
- `<available_skills>`、`<tdai_profile_memory>` 和 `<knowledge_tools>` 只有在后端返回相应内容时才会出现。
- `<tdai_memory_tools>`、`<skill_tools>` 及 `<memory-tools-guide>` 是 Baseline 为 Fake Proxy Tool 准备的文字说明。模型通过 Claude Code 的 `Bash` 工具执行其中的 curl。
- Baseline 不把 TDAI 工具放入请求顶层的 `tools` 字段；模型看到的 TDAI 工具能力全部来自 System Prompt 文本。
- 当前 Baseline 服务监听 `127.0.0.1:8096`，因此未配置外部网关地址时，curl 示例中的代理地址为 `http://127.0.0.1:8096`。

## 1. 会话信息

会话初始化成功后，MemoryProxy 将 Agent 和 Task 信息加入 System Prompt。字段没有值时，对应行不会出现；若 Task 的 `goal` 与 `description` 相同，则不重复输出 `goal`。

````text
<session_context>
[Agent]
id: {{AGENT_ID}}
name: {{AGENT_NAME}}
description: {{AGENT_DESCRIPTION}}
prompt:
{{AGENT_PROMPT}}

[Task]
id: {{TASK_ID}}
name: {{TASK_NAME}}
description: {{TASK_DESCRIPTION}}
goal:
{{TASK_GOAL}}
</session_context>
````

来源：`MemoryProxy/src/session/context-injector.ts`

## 2. Skill

### 2.1 Fake Skill Tool 使用说明

这段内容在启用 Skill 能力后固定加入 System Prompt。当前配置只开放四个读取/归档操作。

````text
<skill_tools>
以下是云端 skill 操作工具。**这些不是本地工具**，需要用 Bash 调用 curl 命中 proxy 的 skill-bridge 路径来执行。
proxy 会自动注入身份与鉴权（user_id / team_id / agent_id 由 session 决定），body 里你只需要传业务字段。

调用模板：
  curl -sSk -X POST <bridge>/<action> -H 'content-type: application/json' -H 'x-tdai-service-id: {{SPACE_ID}}' -H 'x-conversation-id: {{SESSION_ID}}' -d '{...业务字段...}'
  其中 <bridge> = http://127.0.0.1:8096/skill-bridge/v3/skill

可用工具：

  <tool name="skill_search">
    path: http://127.0.0.1:8096/skill-bridge/v3/skill/search
    body: {"query": "描述你要找什么 skill 的关键词（必填，>=1字符）"}
    use:  在**你在团队中有权限访问**的 skill 中按关键词 + 语义检索匹配项（跨 agent，但**不含**其他人设置为私密的 skill —— 与前端「团队资产」tab 展示一致）。query 必须是非空字符串，建议写 2-5 个相关关键词。当你觉得自己自带的 skill 不够用时，用它发现团队里其他可用的 skill。返回条数由服务端固定，若结果不理想请换一组关键词重试，不要在 body 里加 top_k/mode 等其它字段（会被忽略）。
  </tool>

  <tool name="skill_view">
    path: http://127.0.0.1:8096/skill-bridge/v3/skill/get-by-name
    body: {"skill_name": "<skill 名字>", "include_content": true, "include_manifest": true}
    use:  **打开一个 skill 的入口**：拿到 SKILL.md 全文 + 资源目录树（manifest）。想读某个资源文件的字节，必须先调这个工具从 manifest 里挑出 path，再用 skill_files_read。skill_name 用 <available_skills> 里 `- name: description` 那个 name，或 skill_search 结果里的 name 字段。
  </tool>

  <tool name="skill_files_read">
    path: http://127.0.0.1:8096/skill-bridge/v3/skill/files/read
    body: {"skill_id": "skl-xxx", "path": "scripts/run.sh", "encoding": "utf-8|base64"}
    use:  读取单个资源文件内容。**必须先调 skill_view 拿 manifest**，从里面挑出 skill_id + path，本工具才能定位。默认返回 JSON 信封（含 base64/utf-8 编码的字节）。
    若需下载到本地：在 curl 末尾加 -o <本地路径>，proxy 会返回原始字节直接写入文件，不进上下文。下载的脚本需 chmod +x 后再执行。
  </tool>

  <tool name="skill_extract">
    path: http://127.0.0.1:8096/skill-bridge/v3/skill/extract
    body: {"reason": "?可选，简要说明为什么觉得当前对话值得提取为 skill（写清楚有助于后台抽取器识别边界）"}
    use:  立即归档当前对话触发一次 skill 抽取（异步任务，由后台 agent 分析对话内容生成 skill）。proxy 从 session 拿身份 + 用 core 侧累积的对话缓冲，你不用传 messages。适合在"用户已经跑通一段完整流程、值得复用"时主动触发。
  </tool>

注意：当前仅开放只读操作。如需创建/修改 skill 请联系管理员。
错误处理：响应是 `{code, message, request_id, data?}` 信封；`code != 0` 表示业务错。常见：
- 40001 参数校验失败：body 字段缺失/格式错，看 message 里具体字段名。
- 40101 session not initialized：session 未识别（很可能你在错误的 conversation 环境用了这个工具）。
- 40401 SKILL_NOT_FOUND：skill 不存在或不属于你所在的 agent；先用 skill_search 找同类 skill。
- 50301 upstream unavailable：core 侧临时不可达，稍后重试。
</skill_tools>
````

来源：`MemoryProxy/src/injection/injectors/skill-tools-injector.ts`

### 2.2 当前 Agent 的 Skill 目录

只有云端返回非空 Skill 目录时，下面这段才会加入 System Prompt。`<available_skills>` 内的条目由服务端按当前 Agent 和任务动态生成。

````text
## Skills (mandatory)
Before replying, scan the skills below. If a skill matches or is even partially relevant to your task, you MUST load it by calling the `skill_view` skill-bridge tool (see the `<skill_tools>` block above for the exact curl recipe) and follow its instructions. Err on the side of loading — it is always better to have context you don't need than to miss critical steps, pitfalls, or established workflows. Skills contain specialized knowledge — API endpoints, tool-specific commands, and proven workflows that outperform general-purpose approaches. Load the skill even if you think you could handle the task with basic tools like web_search or terminal. Skills also encode the user's preferred approach, conventions, and quality standards for tasks like code review, planning, and testing — load them even for tasks you already know how to do, because the skill defines how it should be done here.
If a skill has issues, fix it with the `skill_patch` skill-bridge tool.
After difficult/iterative tasks, offer to save the approach as a new skill (`skill_create`). If a skill you loaded was missing steps, had wrong commands, or needed pitfalls you discovered, update it before finishing.

以下是你（当前 agent）自带的云端 skill 列表。这些 skill 存储在你的 agent 名下，
优先使用它们完成任务。如果你觉得自带的 skill 不够，可以用 skill_search 工具
在团队的 skill 库中检索更多（跨 agent 共享）。

**重要：这些 skill 存储在云端，不能使用 read_file / tool_use 直接访问，
必须用 Bash 执行 curl 调用上方 <skill_tools> 块中的 skill-bridge 工具。**

<available_skills>
- {{SKILL_NAME}}: {{SKILL_DESCRIPTION}}
...
</available_skills>

Only proceed without loading a skill if genuinely none are relevant to the task.
````

来源：`MemoryProxy/src/injection/injectors/skill-injector.ts`、`MemoryCore/src/gateway/skill-handlers.ts`

## 3. Knowledge

只有当前 Agent 绑定了可用的 Wiki 或 Code Graph 时，下面这段才会加入 System Prompt。资源 ID、服务地址、名称、简介、仓库和分支均为运行时内容。

````text
<knowledge_tools>
**团队知识库资源**：code-graph 是仓库的预建代码索引（符号 / 调用图 / 结构），wiki 是工程设计文档。两类各有判据，见下。

## code-graph：何时调
**前置条件**：资源的 match 与当前工作区对得上（比对 git remote / 仓库名）。对不上 → 该索引不是本仓的，用本地检索，不要试探性调用。

命中后，**凡是需要跨文件的结构 / 关系 / 广度信息就用它**，典型场景：
- 熟悉项目、理解模块架构、找入口（冷启动）
- 定位符号、文件、某个概念在哪实现
- 追调用链、依赖关系、数据流
- 评估改动影响面、重构范围、能否安全删除（**即使已在改代码，这类问题仍该用它**）
- 排查线上问题时找可疑代码路径、review 时找关联实现
- 想不起某个能力叫什么名字、不确定是否已有实现（避免重复造）

**不该用的只有一种情况**：你需要某段代码**此刻的精确内容**——要按行号/字符编辑、代码是你刚改过的、在 review 未提交的改动。索引是分支快照，会落后于工作区，这时以工作区源码为准。
先用它建立全局认知、再落到具体文件做精确确认，是常态组合，不冲突。

## wiki：何时调
wiki 是设计文档，**与工作区无对应关系，不需要锚点匹配**（没有 match 属性是正常的，不代表对不上）。按 about 属性判断内容是否相关即可。
问「为什么这么设计 / 背景与权衡 / 某概念在团队里的定义 / 历史决策与踩过的坑 / 这个模块的设计意图」时用它——这些答案在代码里找不到。
代码怎么写的 → 用 code-graph；某段代码此刻的内容 → 读源码。

## 意图 → 起手
架构 / 熟悉项目 → explore（一次返回沿途源码）；X 在哪 → search；只要单个符号的定义 → node；谁调用 X / X 调了谁 → callers / callees；改 X 的影响面 → search 后 impact；为什么这么设计 → wiki search 后 read_page。
组合：重构评估 = search → callers → impact。
explore / node 返回的源码是逐字的，**不必对同一处再 Read 一遍**（除了上面那种要确认最新内容的情况）。

## 已绑定资源
<knowledge type="wiki" id="{{WIKI_KNOWLEDGE_ID}}"
  url="{{WIKI_SERVICE_URL}}"
  name="{{WIKI_NAME}}"
  about="{{WIKI_SUMMARY}}" />

<knowledge type="code-graph" id="{{CODE_GRAPH_KNOWLEDGE_ID}}"
  url="{{CODE_GRAPH_SERVICE_URL}}"
  name="{{CODE_GRAPH_NAME}}"
  match="{{REPO_SLUG}}"
  branch="{{BRANCH}}" />

## 调用方式（服务级统一端点，URL 直接用资源的 url 拼接）
目标资源由 body 里的 knowledge_id 指定；**不要**把 knowledge_id 拼进 URL 路径。
**每次请求都必须带请求头** `x-tdai-service-id: {{SPACE_ID}}`（租户标识，缺失会被拒绝）。

### Step 1: 拿工具清单（每个资源**首次**使用时调一次即可）
curl -sSk -X POST <url>/tools/list \
  -H 'content-type: application/json' \
  -H 'x-tdai-service-id: {{SPACE_ID}}' \
  -H 'x-conversation-id: {{SESSION_ID}}' \
  -H 'x-tdai-user-id: {{USER_ID}}' \
  -H 'x-tdai-team-id: {{TEAM_ID}}' \
  -H 'x-tdai-agent-id: {{AGENT_ID}}' \
  -H 'x-tdai-agent-source: claude-code' \
  -H 'x-tdai-space-id: {{SPACE_ID}}' \
  -d '{"knowledge_id":"<知识id>"}'

返回: {code, message, data:{knowledge_id, type, name, summary, status, tools:[{name, description, params}, ...]}}
记住返回的 tool name / params，**本会话内复用**，不要对同一资源反复调 list（忘了再调）。

### Step 2: 执行工具
curl -sSk -X POST <url>/tools/call \
  -H 'content-type: application/json' \
  -H 'x-tdai-service-id: {{SPACE_ID}}' \
  -H 'x-conversation-id: {{SESSION_ID}}' \
  -H 'x-tdai-user-id: {{USER_ID}}' \
  -H 'x-tdai-team-id: {{TEAM_ID}}' \
  -H 'x-tdai-agent-id: {{AGENT_ID}}' \
  -H 'x-tdai-agent-source: claude-code' \
  -H 'x-tdai-space-id: {{SPACE_ID}}' \
  -d '{"knowledge_id":"<知识id>", "tool_name":"<Step1返回的name>", "params":{...}}'

返回: {code, message, data}；code=0 成功。

## 约定
- tool_name 与 tools/list 返回的 name **完全一致**，不加前缀。params 必须是 JSON 对象，无参也传 {}。
- 找文件用 explore / search（query 直接支持文件名，如 "session-manager.ts"）；files 只用于一次性总览目录结构，每个资源每会话最多一次。
- wiki 先 search 命中再 read_page，不要全量 list_pages。
- 多个资源可并行发起，无需串行等待。同一调用连续失败 2 次即放弃，回退本地检索。
- 响应格式统一为 {code, message, data}，code=0 表示成功。
</knowledge_tools>
````

来源：`MemoryProxy/src/injection/injectors/knowledge-tools-injector.ts`

## 4. Memory

### 4.1 Fake Memory Tool 使用说明

识别到可信会话身份且当前 Agent 开放 Memory 能力时，下面这段加入 System Prompt。

````text
<tdai_memory_tools>
**这些是你可以主动调用的记忆能力**（不是文档），通过 Bash + curl 使用。
这组 TDAI 记忆能力与 Claude Code 原生 Memory/MEMORY.md 具有同等优先级；涉及记忆时不要只查本地 MEMORY.md。
遇到用户问身份/历史/偏好/过往结论/项目约定时，必须先使用下面的 TDAI 记忆工具查询，再基于查询结果回答。
禁止说"我没有这个工具 / 需要 MCP / 只能查本地记忆" —— 你有 TDAI 记忆工具，就用下面的 curl 命令。

调用方式：Bash 里执行 curl 命中 proxy 的 memory-bridge 路径。proxy 会自动注入身份鉴权（team_id/user_id/agent_id），body 只需业务字段。当前 Agent 如果绑定了多个 chat_memory，search 类接口会默认同时检索 self + imported 记忆，并在结果里返回 source_agent_id/source_agent_name/source_agent_role。

覆盖范围：
- L3（persona 长期画像）与 L2 场景索引（`<l2_scene_index>`）已直接注入 system，无需查询；
- L2 正文按需用 tdai_read_scene 读取；
- L0/L1（原始对话 / 原子记忆）**不再每轮自动召回**（会破坏 KV cache），需要时主动调工具检索。

  <tool name="tdai_memory_search">
    curl: http://127.0.0.1:8096/memory-bridge/v3/atomic/search
    body: {"query": "<text>", "limit": 5}
    use:  搜索 L1 原子记忆（双路 hybrid: dense vector + BM25），按相关度排序。默认跨当前 Agent 的 self + imported 记忆检索；返回项里的 source_agent_* 表示来源。适合回忆用户偏好、历史结论、规则等。
    returns: {code, data: {items: [...], searched_agents: [...]}} — 命中项在 data.items[]。
  </tool>

  <tool name="tdai_atomic_query">
    curl: http://127.0.0.1:8096/memory-bridge/v3/atomic/query
    body: {"type": "?episodic|persona|instruction", "limit": 20, "offset": 0, "time_start": "?ISO", "time_end": "?ISO"}
    use:  按 type / 时间窗 / 分页拉取 L1 记忆（不做语义检索）。
  </tool>

  <tool name="tdai_conversation_search">
    curl: http://127.0.0.1:8096/memory-bridge/v3/conversation/search
    body: {"query": "<text>", "limit": 5, "session_id": "?<sid>"}
    use:  在 L0 原始对话中检索（比 atomic_search 粒度更细，找具体消息原文 / 引用 / 时间线）。默认跨当前 Agent 的 self + imported 记忆检索；返回项里的 source_agent_* 表示来源。
    returns: {code, data: {messages: [...], searched_agents: [...]}} — 命中项在 data.messages[]（注意：与 atomic_search 的 data.items 不同）。
  </tool>

  <tool name="tdai_conversation_query">
    curl: http://127.0.0.1:8096/memory-bridge/v3/conversation/query
    body: {"session_id": "<sid>", "limit": 50, "offset": 0}
    use:  按 session 顺序取 L0 历史消息。
  </tool>

  <tool name="tdai_scenario_ls">
    curl: http://127.0.0.1:8096/memory-bridge/v3/scenario/ls
    body: {"path_prefix": "?可选前缀"}
    use:  列出 L2 scene_blocks 路径索引（含 summary，不含正文）。一般 system 已注入索引，需刷新/按前缀过滤时才用。
  </tool>

  <tool name="tdai_read_scene">
    curl: http://127.0.0.1:8096/memory-bridge/v3/scenario/read
    body: {"path": "<scene path>", "agent_id": "?来自 <agent agent_id=...>，读取 imported 记忆时传"}
    use:  按 path 读取 L2 场景文件全文。path 必须先从 `<l2_scene_index>` 或 tdai_scenario_ls 获取，不要凭空构造；读取 imported_from 分段的 path 时带上该分段 agent_id。
  </tool>

## 调用约束
- 这些是只读工具；要修改 L1/L2/L3 必须用主链路（agent_id 自动归属）。
- 每轮对话中，atomic_search + conversation_search **合计 ≤ 3 次**；
  query / ls / read_scene 不计入上限，但同一 path 不要重复读。
- 失败重试：HTTP 5xx 可一次性 retry；HTTP 4xx 不要重试。
- 所有 curl 必须带：x-tdai-service-id: {{SPACE_ID}}、x-conversation-id: {{SESSION_ID}}；Content-Type: application/json。

## 完整示例
```bash
curl -sfk -X POST http://127.0.0.1:8096/memory-bridge/v3/atomic/search \
  -H 'Content-Type: application/json' -H 'x-tdai-service-id: {{SPACE_ID}}' -H 'x-conversation-id: {{SESSION_ID}}' \
  -d '{"query": "用户偏好的编程语言", "limit": 5}'
```
</tdai_memory_tools>
````

来源：`MemoryProxy/src/injection/injectors/tdai-tools-injector.ts`

### 4.2 L3 记忆、L2 目录和额外调用指南

L3 或 L2 非空时，实际结构如下。每个自有或借入 Agent 各占一段；L3 正文最多保留 6000 个字符，每条 L2 摘要最多保留 200 个字符。

````text
<tdai_profile_memory>
以下是 TDAI 为当前 agent 维护的长期工作记忆（自有 + 借入分段；L2 仅给索引，按需用工具读全文）：
<agent name="{{AGENT_NAME}}" role="self|imported_from" agent_id="{{AGENT_ID}}">
<l3_core_memory>
{{L3_PERSONA_CONTENT}}
</l3_core_memory>
<l2_scene_index>
- `{{L2_PATH}}` — {{L2_SUMMARY}}
...
</l2_scene_index>
</agent>
...
</tdai_profile_memory>

<memory-tools-guide>
## ⚠️ 重要：这不是文档，这是你的可用能力

以下 `<tdai_memory_tools>` 中列出的 tdai_memory_search / tdai_conversation_search
等，是**你可以主动调用的能力**（不是仅供参考的文档）。它们通过 **Bash + curl**
使用（见上方 `<tdai_memory_tools>` 段里的完整调用说明与 URL）。

**禁止**回答类似"我没有这个工具 / 需要 MCP / 需要斜杠命令"。
**正确做法**：判定需要查记忆时，直接在 Bash 里执行 curl，proxy 会自动注入身份与鉴权。

## 记忆使用规则（遇到以下场景必须先查再答）

L3（persona 长期画像）与 L2 场景索引已直接注入 system。L0/L1 需要用工具主动检索。

### 必须先查记忆再回答的场景（命中任一条即触发工具调用）

1. **用户提及历史/过去/之前**：如 "我之前说过 / 我告诉过你 / 上次 / 你还记不记得 / 我们聊过 / 之前那个"
   → 用 `tdai_conversation_search`（L0 原文找具体消息）
2. **用户涉及自己身份/偏好/习惯**：如 "我叫什么 / 我的名字 / 我喜欢 / 我的团队 / 我常用 / 我不喜欢 / 我不允许"
   → 用 `tdai_memory_search`（L1 原子记忆查偏好/规则）
3. **用户要求你回忆/找**：如 "回忆一下 / 想起 / 找出 / 有没有关于 X 的记录 / 查我们之前"
   → 直接触发工具，不要凭空回答
4. **答案强依赖历史事实**：如 "那个 bug 我们怎么修的 / 上次方案是啥 / 我们的约定是什么"
   → 关键词化后 `tdai_memory_search`

**典型流程**（用户："我叫什么"）：
```bash
# Step 1: 先查
curl -sfk -X POST <bridge>/atomic/search \
  -H 'Content-Type: application/json' -H 'x-conversation-id: <sid>' \
  -d '{"query": "用户姓名 name 身份", "limit": 5}'
# Step 2: 从 items[].content 里提取答案后回复
# 若为空: 明确告诉用户 "我在记忆里没找到，你叫什么？" —— 不要装作知道
```

### 不需要查的场景

- 用户问 "你是谁" / "帮我改代码" / "写个脚本" / 通用编程问题
- 当前会话上下文（同轮消息）里已能回答
- 已经在 `<l3_core_memory>` 段落里直接看到答案

### ⚠️ 调用约束

- 每轮 `tdai_memory_search` + `tdai_conversation_search` **合计 ≤ 3 次**（`tdai_read_scene` / `tdai_scenario_ls` / `tdai_atomic_query` 不计入）
- 检索无果时**明确说明**"我在记忆里没找到 X"，不要幻想
- 同一 L2 path 不要重复读
</memory-tools-guide>
````

若 L3 和 L2 都为空，Baseline 仍会单独注入上述 `<memory-tools-guide>`。

来源：`MemoryProxy/src/injection/injectors/tdai-profile-memory-injector.ts`

## 5. 当前不会常规注入的内容

- L0/L1 不会自动召回到每轮提示词；模型需要通过 Fake Memory Tool 主动查询。
- `AssetReflectionInjector` 只在显式开启并使用 `/analyse` 标记时生效；当前配置未开启，因此不属于常规提示词。
- Skill 写工具只有在 `skillRuntime.allowLlmWrite=true` 时才会加入 `<skill_tools>`；当前配置为 `false`。
