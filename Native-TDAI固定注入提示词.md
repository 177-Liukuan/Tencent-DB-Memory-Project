# Native 项目：TDAI 固定注入内容

本文于 2026-09-06 按 Native 当前源码和本机运行配置核对更新，供人工阅读。对应 `research/native-tool` 分支提交 `2d7441b`。代码块保留源码中的原始措辞，不另行润色。本次只调整提示词和工具、参数的 description，没有修改工具参数约束、权限、执行或历史恢复逻辑。81 项相关测试和 TypeScript 检查通过，Native MemoryProxy 已重启，未继续评测。

当前运行配置启用了 `skill`、`knowledge`、`tdai-memory` 和 Native Proxy Tool，`skillRuntime.allowLlmWrite=false`。因此，当前正常的 Claude Code 流式请求最多会加入 12 个 TDAI Native Proxy Tool：6 个 Memory Tool、4 个 Skill 读取/归档 Tool、2 个 Knowledge Tool。

## 阅读说明

- Native 项目仍会向 System Prompt 加入会话信息以及动态的 Memory、Skill、Knowledge 目录，但不再加入 Bash、curl、内部 URL、请求头、鉴权或 Fake Tool 使用说明。
- Native Tool 定义不属于 System Prompt。它们通过请求顶层的 `tools` 字段发送给模型。本文件把两类内容分开列出。
- `{{...}}` 表示运行时数据，不是固定文字。
- `<available_skills>`、`<knowledge_catalog>` 和 `<tdai_profile_memory>` 只有在后端返回相应内容时才出现；没有相应资产时不会生成空占位文案。
- `<memory-tools-guide>` 随实际开放的 Memory 真工具注入，不依赖 L2/L3 是否为空。当前不再生成 `<native_tool_usage>` 两类工具选择说明。
- Tool Schema 只在受支持的流式请求、可信会话身份和对应能力均满足时加入。若 Claude Code 已声明同名工具，请求会因名称冲突而停止，不会把两个同名定义同时交给模型。
- 下文按 Anthropic 的 `name + description + input_schema` 形式展示工具定义。Chat Completions 和 Responses 使用各自的协议格式，工具名称、说明和参数含义相同。
- 以下按内容分类展示，不代表最终请求中各个注入块的排列顺序，也不包含 Claude Code 自带的 System Prompt。会话信息、目录条目和记忆正文是动态内容，不应计入固定工具说明的 Token 量。

## 一、System Prompt 中的内容

### 1. 会话信息

这部分与 Baseline 相同。会话初始化成功后，MemoryProxy 按 `sessionInit.injectAgentContext` 和 `injectTaskContext` 开关，将 Agent 和 Task 信息加入 System Prompt。可选字段没有值时，对应行不会出现；若 Task 的 `goal` 与 `description` 相同，则不重复输出 `goal`。

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

### 2. 当前 Agent 的 Skill 目录

只有云端返回非空 Skill 目录时，下面这段才会加入 System Prompt。`<available_skills>` 内的条目由服务端按当前 Agent 和任务动态生成。

````text
## Skills (mandatory)
Before replying, scan the skills below. If a skill matches or is even partially relevant to your task, you MUST load it by calling the `skill_view` tool and follow its instructions. Err on the side of loading — it is always better to have context you don't need than to miss critical steps, pitfalls, or established workflows. Skills contain specialized knowledge — API endpoints, tool-specific commands, and proven workflows that outperform general-purpose approaches. Load the skill even if you think you could handle the task with basic tools like web_search or terminal. Skills also encode the user's preferred approach, conventions, and quality standards for tasks like code review, planning, and testing — load them even for tasks you already know how to do, because the skill defines how it should be done here.
以下是你（当前 agent）自带的云端 skill 列表。这些 skill 存储在你的 agent 名下，
优先使用它们完成任务。如果你觉得自带的 skill 不够，可以用 skill_search 工具
在团队的 skill 库中检索更多（跨 agent 共享）。

**重要：这些 skill 存储在云端，不能通过本地文件工具直接访问，
必须调用 skill_view 读取正文和资源目录，再用 skill_files_read 读取资源文件。**

<available_skills>
- {{SKILL_NAME}}: {{SKILL_DESCRIPTION}}
...
</available_skills>

Only proceed without loading a skill if genuinely none are relevant to the task.
````

来源：`MemoryProxy/src/injection/injectors/skill-injector.ts`、`MemoryCore/src/gateway/skill-handlers.ts`

### 3. Knowledge 资源目录

只有当前 Agent 绑定了可用的 Wiki 或 Code Graph 时，下面这段才会加入 System Prompt。Native 项目只在这里介绍资源用途，不再向模型暴露服务地址和 curl 调用过程。

````text
<knowledge_catalog>
当前 Agent 可使用以下云端知识资源。Wiki 适合查询设计背景、历史决策和团队文档；Code Graph 适合查询与当前仓库匹配的跨文件结构、符号关系和影响范围。需要确认本地未提交代码的精确内容时，仍使用客户端文件工具。
<knowledge type="wiki" id="{{WIKI_KNOWLEDGE_ID}}" name="{{WIKI_NAME}}" about="{{WIKI_SUMMARY}}" />
<knowledge type="code-graph" id="{{CODE_GRAPH_KNOWLEDGE_ID}}" name="{{CODE_GRAPH_NAME}}" match="{{REPO_SLUG}}" branch="{{BRANCH}}" />
首次使用某个资源时，先调用 tdai_knowledge_tools_list 获取它当前提供的工具和参数，再用 tdai_knowledge_tool_call 执行；knowledge_id 必须来自上面的目录。
</knowledge_catalog>
````

来源：`MemoryProxy/src/injection/injectors/knowledge-catalog-injector.ts`

### 4. L3 记忆和 L2 目录

只有 L3 或 L2 至少有一项内容时，下面这段才会加入 System Prompt。每个自有或借入 Agent 各占一段；L3 正文最多保留 6000 个字符，每条 L2 摘要最多保留 200 个字符。

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
````

来源：`MemoryProxy/src/injection/injectors/tdai-profile-memory-injector.ts`

这一块仅保留动态记忆内容，不重复列出六个 Memory 工具。L0/L1 的查询方式与使用条件见下一节；工具用途在 `tools` 的 description 中。

### 5. Memory 使用规则

保留 Baseline 的四类查询触发条件、不需要查询的场景及原有调用约束；将 Bash/curl 调用说明替换为直接调用对应工具。以下整段是当前代码生成的原文：

```text
<memory-tools-guide>
这组 TDAI 记忆能力与 Claude Code 原生 Memory/MEMORY.md 具有同等优先级；涉及记忆时不要只查本地 MEMORY.md。
遇到用户问身份/历史/偏好/过往结论/项目约定时，必须先使用 TDAI 记忆工具查询，再基于查询结果回答。
需要查记忆时，直接调用对应的 TDAI Memory Tool。

## 记忆使用规则（遇到以下场景必须先查再答）

L3（persona 长期画像）与 L2 场景索引已直接注入 system。L2 正文按需用 tdai_read_scene 读取；L0/L1（原始对话 / 原子记忆）不再每轮自动召回，需要用工具主动检索。

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
先调用 `tdai_memory_search`，参数为 {"query": "用户姓名 name 身份", "limit": 5}，再基于查询结果回答。
若为空，明确告诉用户 "我在记忆里没找到，你叫什么？" —— 不要装作知道。

### 不需要查的场景

- 用户问 "你是谁" / "帮我改代码" / "写个脚本" / 通用编程问题
- 当前会话上下文（同轮消息）里已能回答
- 已经在 `<l3_core_memory>` 段落里直接看到答案

### ⚠️ 调用约束

- 这组工具只读，不能用于修改 L1/L2/L3。
- 每轮 `tdai_memory_search` + `tdai_conversation_search` **合计 ≤ 3 次**（`tdai_read_scene` / `tdai_scenario_ls` / `tdai_atomic_query` 不计入）
- 检索无果时**明确说明**"我在记忆里没找到 X"，不要幻想
- 同一 L2 path 不要重复读
</memory-tools-guide>
```

该规则由 Native Tool 注入器在 Memory 工具确实开放时加入 System；即使 L2/L3 都为空也会出现，Memory 能力关闭或请求不满足 Native 注入条件时不会出现。Skill 的加载要求放在前面的 Skill 目录说明中，不再额外增加一份与 Baseline 不同的分类引导。

“每轮搜索合计 ≤ 3 次”是沿用 Baseline 的提示词要求，不是本次新增的程序硬限制。现有 Dispatcher 的超时、自动重试和总调用限制没有变化。规则中“L3/L2 已注入”的表述沿用 Baseline；实际没有对应资产时，不会生成空的画像或场景目录。

来源：`MemoryProxy/src/native-proxy-tools/native-proxy-tools-injector.ts`

## 二、请求顶层 `tools` 中的 Native Proxy Tool

下面是当前配置下会发送给 Anthropic 上游模型的 TDAI Tool Schema。Claude Code 自带的 `Bash`、`Read`、`Write` 等客户端工具仍在同一个 `tools` 数组中，但不在本文重复列出。

以下 12 个定义已与当前 Registry 逐项核对，名称、description 和 input_schema 一致。是否全部出现仍取决于当前 Agent 的能力和 Knowledge 目录；未绑定 Knowledge 资源时，不注入两个 Knowledge 工具。

### 1. Memory Tool（6 个）

```json
[
  {
    "name": "tdai_memory_search",
    "description": "搜索 L1 原子记忆（双路 hybrid: dense vector + BM25），按相关度排序。默认跨当前 Agent 的 self + imported 记忆检索；返回项里的 source_agent_* 表示来源。适合回忆用户偏好、历史结论、规则等。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "检索问题或关键词"
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
  },
  {
    "name": "tdai_atomic_query",
    "description": "按 type / 时间窗 / 分页拉取 L1 记忆（不做语义检索）。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "type": {
          "type": "string",
          "enum": ["episodic", "persona", "instruction"]
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100,
          "default": 20
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000,
          "default": 0
        },
        "time_start": {
          "type": "string",
          "format": "date-time"
        },
        "time_end": {
          "type": "string",
          "format": "date-time"
        }
      }
    }
  },
  {
    "name": "tdai_conversation_search",
    "description": "在 L0 原始对话中检索（比 tdai_memory_search 粒度更细，找具体消息原文 / 引用 / 时间线）。默认跨当前 Agent 的 self + imported 记忆检索；返回项里的 source_agent_* 表示来源。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "检索问题或关键词"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20,
          "default": 5
        },
        "session_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "可选的历史会话标识"
        }
      },
      "required": ["query"]
    }
  },
  {
    "name": "tdai_conversation_query",
    "description": "按 session 顺序取 L0 历史消息。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "session_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "需要读取的会话标识"
        },
        "limit": {
          "type": "integer",
          "minimum": 1,
          "maximum": 200,
          "default": 50
        },
        "offset": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100000,
          "default": 0
        }
      },
      "required": ["session_id"]
    }
  },
  {
    "name": "tdai_scenario_ls",
    "description": "列出 L2 scene_blocks 路径索引（含 summary，不含正文）。一般 system 已注入索引，需刷新/按前缀过滤时才用。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "path_prefix": {
          "type": "string",
          "maxLength": 1024
        }
      }
    }
  },
  {
    "name": "tdai_read_scene",
    "description": "按 path 读取 L2 场景文件全文。path 必须先从 `<l2_scene_index>` 或 tdai_scenario_ls 获取，不要凭空构造；读取 imported_from 分段的 path 时带上该分段 agent_id。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "description": "场景路径"
        },
        "agent_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "description": "借入场景所属的 Agent 标识"
        }
      },
      "required": ["path"]
    }
  }
]
```

### 2. Skill Tool（当前开放 4 个）

```json
[
  {
    "name": "skill_search",
    "description": "在**你在团队中有权限访问**的 skill 中按关键词 + 语义检索匹配项（跨 agent，但**不含**其他人设置为私密的 skill —— 与前端「团队资产」tab 展示一致）。query 必须是非空字符串，建议写 2-5 个相关关键词。当你觉得自己自带的 skill 不够用时，用它发现团队里其他可用的 skill。返回条数由服务端固定，若结果不理想请换一组关键词重试，不要添加 top_k/mode 等 Schema 中未定义的参数（会被拒绝）。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "query": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "Skill 关键词"
        }
      },
      "required": [
        "query"
      ]
    }
  },
  {
    "name": "skill_view",
    "description": "**打开一个 skill 的入口**：拿到 SKILL.md 全文 + 资源目录树（manifest）。想读某个资源文件的字节，必须先调这个工具从 manifest 里挑出 path，再用 skill_files_read。skill_name 用 <available_skills> 里 `- name: description` 那个 name，或 skill_search 结果里的 name 字段。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "skill_name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 64,
          "description": "Skill 名称"
        }
      },
      "required": [
        "skill_name"
      ]
    }
  },
  {
    "name": "skill_files_read",
    "description": "读取单个资源文件内容。**必须先调 skill_view 拿 manifest**，从里面挑出 skill_id + path，本工具才能定位。返回文件内容及编码等信息。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "skill_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000,
          "description": "Skill 标识"
        },
        "path": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1024,
          "description": "资源相对路径"
        },
        "encoding": {
          "type": "string",
          "enum": [
            "utf-8",
            "base64"
          ],
          "default": "utf-8"
        }
      },
      "required": [
        "skill_id",
        "path"
      ]
    }
  },
  {
    "name": "skill_extract",
    "description": "立即归档当前对话触发一次 skill 抽取（异步任务，由后台 agent 分析对话内容生成 skill）。使用当前会话已累积的对话，你不用传 messages。适合在\"用户已经跑通一段完整流程、值得复用\"时主动触发。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "reason": {
          "type": "string",
          "description": "简要说明为什么觉得当前对话值得提取为 skill（写清楚有助于后台抽取器识别边界）",
          "maxLength": 2000
        }
      }
    }
  }
]
```

#### 未开放的 Skill 写工具

这六个工具仍受 `skillRuntime.allowLlmWrite` 控制，当前不会出现在上游请求中。本次仅调整工具和参数的 description；字段类型、必填项、默认值、长度限制、校验与执行不变。

| 工具 | 当前 description |
|---|---|
| `skill_create` | 新建 skill；owner 自动 = 当前 agent。 |
| `skill_update` | 替换 SKILL.md（version+1）。 |
| `skill_patch` | SKILL.md 子串替换（避免大 diff）。 |
| `skill_delete` | 永久删除当前 Agent 拥有的 Skill，包括所有版本和资源文件。 |
| `skill_files_write` | 增/改资源文件（version+1）。 |
| `skill_files_remove` | 删资源文件（实际删除文件时 version+1）。 |

参数解释放在 Schema 对应字段中，不在工具用途里重复。此次整理的字段说明如下，其余字段保留原有说明：

| 工具 | 参数 | 参数 description |
|---|---|---|
| `skill_create` | `content` | SKILL.md 全文（含 frontmatter）；frontmatter.name 必须与 name 相同 |
| `skill_create` | `resources` | 创建 Skill 时附带的资源文件 |
| `skill_update` | `content` | 新的完整 SKILL.md，不能更改 frontmatter.name |
| `skill_patch` | `old_string` | 需要在 SKILL.md 中匹配的原文本 |
| `skill_patch` | `new_string` | 替换后的文本，可为空字符串 |
| `skill_patch` | `replace_all` | 是否替换所有匹配项；false 时 old_string 必须唯一匹配 |
| `skill_files_write` | `files` | 要新增或覆盖的资源文件 |
| `skill_files_remove` | `paths` | 要删除的资源相对路径 |

`skill_delete` 仍使用原有的 `skill_id` 参数。它的永久删除说明与后端一致，没有采用 Baseline 提示词中已过时的“软删”。

### 3. Knowledge Tool（2 个）

这两个工具只有在本次请求已成功加入非空 `<knowledge_catalog>` 时才会发送给模型。

```json
[
  {
    "name": "tdai_knowledge_tools_list",
    "description": "获取指定已授权 Knowledge 资源当前提供的工具清单、用途和参数说明；首次使用目录中的 knowledge_id 时先调用本工具。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "knowledge_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "description": "Knowledge 资源目录中的资源标识"
        }
      },
      "required": ["knowledge_id"]
    }
  },
  {
    "name": "tdai_knowledge_tool_call",
    "description": "执行 tdai_knowledge_tools_list 返回的 Knowledge 查询工具；tool_name 和 params 必须严格采用该资源最新工具清单中的定义。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "knowledge_id": {
          "type": "string",
          "minLength": 1,
          "maxLength": 256,
          "description": "Knowledge 资源目录中的资源标识"
        },
        "tool_name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 128,
          "description": "工具清单返回的工具名称"
        },
        "params": {
          "type": "object",
          "description": "按工具清单中的参数说明填写；无参数工具传空对象",
          "additionalProperties": true
        }
      },
      "required": ["knowledge_id", "tool_name", "params"]
    }
  }
]
```

来源：`MemoryProxy/src/native-proxy-tools/tool-registry.ts`、`MemoryProxy/src/native-proxy-tools/native-proxy-tools-injector.ts`

## 三、当前不会常规注入的内容

- 不再注入 `<tdai_memory_tools>`、`<skill_tools>`、`<native_tool_usage>`、curl 示例、Bridge URL、请求头、鉴权说明和 Fake Tool 错误处理说明。`<memory-tools-guide>` 已恢复为不含传输细节的使用规则，不是 Fake Tool 调用模板。
- L0/L1 不会自动召回到每轮提示词；模型通过 Memory Native Tool 按需查询。
- Skill 写工具 `skill_create`、`skill_update`、`skill_patch`、`skill_delete`、`skill_files_write`、`skill_files_remove` 已在 Registry 中实现，但当前 `skillRuntime.allowLlmWrite=false`，所以不会发送给模型。
- `AssetReflectionInjector` 只在显式开启并使用 `/analyse` 标记时生效；当前配置未开启，因此不属于常规提示词。

## 四、本次与 Baseline 对齐的范围和保留差异

- 本次对齐 Memory / Skill，不再以提高某一组调用率为目的单独改写用途或触发条件。当前 Baseline 代码中的 `use` 是 description 的主要来源；原来的 `atomic_search` 简称改为真实工具名 `tdai_memory_search`。
- Baseline 本来就有“TDAI 与本地 MEMORY.md 同等优先级”的说明。本次保留其“不要只查本地”的原意，撤去 Native 后来增加的“二者都应查询和参考”。
- Skill 保留 Baseline 的英文加载要求和优先使用自带 Skill 的说明；不是新加一套强制策略。不会要求调用可能未开放的 `skill_create` / `skill_patch`，因此没有照搬 Baseline 中这两句写操作指令。
- `skill_extract` 的用途和触发条件不变，`reason` 的解释放入对应参数的 description，仍为可选字段。`skill_files_read` 补充“返回文件内容及编码等信息”，不加入本地下载指令。
- 六个 Skill 写工具沿用 Baseline 的 `use` 表达用途；`content`、`resources`、`old_string`、`new_string`、`replace_all`、`files`、`paths` 的解释放入 Schema，不增加新的触发条件。
- `skill_delete` 继续写明永久删除，不照搬 Baseline 已过时的“软删”；`skill_files_remove` 继续说明实际删除文件才产生新版本。必要的参数约束仍保留，未增加选择优先级。
- Native 拒绝未定义参数，而 Baseline 某些接口会忽略它们。因此 `skill_search` 中“不要添加 top_k/mode”保留，但错误后果按 Native 实际写为“会被拒绝”。
- 工具结果由 Native 执行器统一封装，结果大小上限和重试由现有代码处理。不照搬原 HTTP 返回信封、状态码重试和 `curl -o` 下载说明；本次没有修改这些执行差异。`skill_view` 的 `include_content` / `include_manifest` 仍由执行前的参数处理固定补为 true。
- Knowledge 目录和两个包装工具本次未改，仍是前面的简洁版本；不能据此声称 Knowledge 的提示词也已与 Baseline 对齐。Memory/Skill 主对照应让两组都不绑定 Knowledge 资源。
- description 中的 hybrid/dense/BM25 沿用 Baseline 的能力说明，不代表本机已经启用向量检索。本次没有调整 embedding 或检索配置。
- 固定 Token 应计入 Skill 目录前后的使用说明、`<memory-tools-guide>`、记忆块的固定说明和 Native Tool 定义；动态 Skill 条目、L2/L3 内容不计入。已有 Token 采集能识别这些块，但评测套件仍可能将 `## Skills (mandatory)` / `<memory-tools-guide>` 标记为 `native_contains_fake_tool_guidance`；这是旧告警条件，不等于当前内容包含 curl，下一次评测前需单独调整。本次未修改评测套件或评分公式。

Native MemoryProxy 已于 2026-09-06 15:22 UTC 从上述源码重启，健康检查返回 `status=ok`、`nativeProxyTools.ready=true`。本文仍是源码内容快照，不是新一轮模型实测结果。验证新提示词时请新建会话，避免复用 session_init 缓存中的旧目录说明。
