# Native 项目：TDAI 固定注入内容

本文按 Native 当前代码、当前工作区和运行配置整理，供人工阅读。基准提交为 `research/native-tool` 分支的 `f7de92f`；本文同时包含当前工作区尚未提交的 Tool Schema 文案与 `tdai_read_scene.agent_id` 修改，因为这些也是当前代码实际会生成的内容。

当前运行配置启用了 `skill`、`knowledge`、`tdai-memory` 和 Native Proxy Tool，`skillRuntime.allowLlmWrite=false`。因此，当前正常的 Claude Code 流式请求最多会加入 12 个 TDAI Native Proxy Tool：6 个 Memory Tool、4 个 Skill 读取/归档 Tool、2 个 Knowledge Tool。

## 阅读说明

- Native 项目仍会向 System Prompt 加入会话信息以及动态的 Memory、Skill、Knowledge 目录，但不再加入 Bash、curl、内部 URL、请求头、鉴权或 Fake Tool 使用说明。
- Native Tool 定义不属于 System Prompt。它们通过请求顶层的 `tools` 字段发送给模型。本文件把两类内容分开列出。
- `{{...}}` 表示运行时数据，不是固定文字。
- `<available_skills>`、`<knowledge_catalog>` 和 `<tdai_profile_memory>` 只有在后端返回相应内容时才出现；没有相应资产时不会生成空占位文案。
- Tool Schema 只在受支持的流式请求、可信会话身份和对应能力均满足时加入。若 Claude Code 已声明同名工具，请求会因名称冲突而停止，不会把两个同名定义同时交给模型。
- 当前 Claude Code → MemoryProxy → DeepSeek 路径使用 Anthropic Messages，因此下文按 Anthropic 的 `name + description + input_schema` 形式展示。Chat Completions 和 Responses 只改变协议外壳，不改变工具名称、说明和参数含义。

## 一、System Prompt 中的内容

### 1. 会话信息

这部分与 Baseline 相同。会话初始化成功后，MemoryProxy 将 Agent 和 Task 信息加入 System Prompt。字段没有值时，对应行不会出现；若 Task 的 `goal` 与 `description` 相同，则不重复输出 `goal`。

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
## Available Cloud Skills
以下是当前 Agent 关联的云端 Skill。
需要查找或读取 Skill 内容时，使用 `skill_search` 和 `skill_view`；读取 Skill 资源文件时，使用 `skill_files_read`。
云端 Skill 内容通过上述 Skill 工具读取，不在本地文件系统中。

<available_skills>
- {{SKILL_NAME}}: {{SKILL_DESCRIPTION}}
...
</available_skills>

只有在实际读取 Skill 内容后，才能声称已经使用该 Skill。
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
以下是 TDAI 长期记忆，它与 Claude Code 本地 MEMORY.md 是不同的数据源，但具有同等优先级。
L3 内容可直接参考；L2 只列路径和摘要，需要正文时使用 `tdai_read_scene` 读取所列路径。
涉及用户身份、偏好、过往经历或项目约定时，不要只依赖本地记忆，可以调用 TDAI 相关工具查询云端记忆；当前上下文没有可靠答案时，应使用 TDAI Memory 工具查询。
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

## 二、请求顶层 `tools` 中的 Native Proxy Tool

下面是当前配置下会发送给 Anthropic 上游模型的 TDAI Tool Schema。Claude Code 自带的 `Bash`、`Read`、`Write` 等客户端工具仍在同一个 `tools` 数组中，但不在本文重复列出。

### 1. Memory Tool（6 个）

```json
[
  {
    "name": "tdai_memory_search",
    "description": "按关键词和语义搜索 L1 已提炼的长期记忆，适合查询用户偏好、身份、规则和历史结论。默认同时搜索当前 Agent 的自有记忆和已授权借入记忆，结果中的 source_agent_* 标明来源；需要具体消息原文、引用或时间线时使用 tdai_conversation_search。",
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
    "description": "按已知类型、时间范围和分页条件读取 L1 原子记忆，不进行语义检索；按含义查找时使用 tdai_memory_search。",
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
    "description": "语义搜索 L0 原始对话，适合查找具体消息原文、引用和时间线；稳定偏好、规则或结论优先使用 tdai_memory_search。",
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
    "description": "按已知 session_id 顺序读取 L0 历史消息，不进行语义检索；不知道会话标识或需要按含义查找时使用 tdai_conversation_search。",
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
    "description": "列出 L2 场景路径和摘要索引，不读取完整正文。System 中通常已经注入场景索引，仅在需要刷新或按 path_prefix 筛选时调用；确定目标路径后使用 tdai_read_scene 读取正文。",
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
    "description": "读取从已注入的场景索引或 tdai_scenario_ls 结果中取得的 L2 场景路径全文；不要凭空构造 path。读取 imported_from 分段中的借入场景时，同时传入该分段列出的 agent_id。",
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
    "description": "按关键词和语义检索当前用户有权访问的团队云端 Skill，不返回无权访问的私有 Skill。query 建议使用 2～5 个相关关键词；结果不理想时更换关键词重试，不要添加 Schema 中未定义的字段。搜索结果包含 Skill 名称；找到目标后使用 skill_view 读取完整正文和资源目录。",
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
      "required": ["query"]
    }
  },
  {
    "name": "skill_view",
    "description": "按 skill_name 读取完整 SKILL.md 和资源目录。skill_name 应来自已注入的 Skill 列表或 skill_search 结果；需要读取资源文件时，先从返回的目录取得 skill_id 和文件路径，再调用 skill_files_read。",
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
      "required": ["skill_name"]
    }
  },
  {
    "name": "skill_files_read",
    "description": "读取某个 Skill 资源目录中的单个文件。skill_id 和 path 必须来自 skill_view 返回的资源目录。",
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
          "enum": ["utf-8", "base64"],
          "default": "utf-8"
        }
      },
      "required": ["skill_id", "path"]
    }
  },
  {
    "name": "skill_extract",
    "description": "归档当前会话并异步触发一次 Skill 提取，适合在用户已经完成一套完整且值得复用的流程时使用。可以通过可选的 reason 简要说明该流程值得提取的原因。",
    "input_schema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "reason": {
          "type": "string",
          "maxLength": 2000
        }
      }
    }
  }
]
```

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

- 不再注入 `<tdai_memory_tools>`、`<skill_tools>`、`<memory-tools-guide>`、curl 示例、Bridge URL、请求头、鉴权说明和 Fake Tool 错误处理说明。
- L0/L1 不会自动召回到每轮提示词；模型通过 Memory Native Tool 按需查询。
- Skill 写工具 `skill_create`、`skill_update`、`skill_patch`、`skill_delete`、`skill_files_write`、`skill_files_remove` 已在 Registry 中实现，但当前 `skillRuntime.allowLlmWrite=false`，所以不会发送给模型。
- `AssetReflectionInjector` 只在显式开启并使用 `/analyse` 标记时生效；当前配置未开启，因此不属于常规提示词。
