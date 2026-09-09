# TencentDB Agent Memory：`injection/types.ts` 阅读笔记

![](E:\桌面\intern\project\手稿\fig\types.ts解读.png)



## 0. 文件定位

文件：

```text
MemoryProxy/src/injection/types.ts
```

`types.ts` 是 **Context Injection 模块的核心类型契约文件**。

它本身基本不负责真正执行：

- Memory 检索
- Prompt 拼接
- Hook Cache 读写
- AgentProfile 匹配
- Protocol Adapter 转换

它主要回答的是：

> **Context Injection 系统中的核心对象分别是什么，它们之间应该通过什么统一的数据结构协作。**

可以把它理解成整个 Injection 模块的“公共语言”和“接口协议”。

核心抽象：

```text
ContextBlock
ContextMessage
AgentTool
AgentContextMetadata
AgentContext

InjectionPoint
SemanticSlot
AnchorTarget

HookPriority
CacheStrategy
PrewarmInput

InjectionHook
HookRegistry
```

---

# 1. 一句话理解整个文件

`types.ts` 建立了一套：

> **“协议无关的 Agent 请求表示 + 可插拔 Hook + 固定/动态注入定位 + Hook 调度 + Session 缓存策略”**

的统一抽象。

整个体系可以先记成：

```text
外部 Agent 请求
(OpenAI / Anthropic)
        ↓
     Adapter
        ↓
   AgentContext
        ↓
Injection Pipeline
        ↓
   InjectionHook
        │
        ├── HookPriority
        │      ↓
        │   谁先执行
        │
        ├── CacheStrategy
        │      ↓
        │   内容从哪里来
        │
        ├── execute / prewarm
        │      ↓
        │   生成 ContextBlock
        │
        └── AnchorTarget / InjectionPoint
               ↓
            注入到哪里
        ↓
修改后的 AgentContext
        ↓
      Adapter
        ↓
原协议请求 → LLM
```

---

# 2. 第一层：统一 Context 数据模型

## 2.1 `ContextBlock`：最小内容单元

系统没有直接把 Prompt 当成一大段字符串，而是抽象成：

```text
ContextBlock
```

支持：

```text
text
tool_use
tool_result
thinking
image
custom
```

结构：

```text
ContextBlock
├── type
├── content
└── metadata?
```

核心思想：

> **把不同协议中的内容统一抽象成 Block。**

例如 OpenAI 可能更偏 message/string，而 Anthropic 本身大量使用 ContentBlock；进入 Injection 核心层后统一表示。

---

## 2.2 `ContextMessage`：标准化消息

结构：

```text
ContextMessage
├── role
│   ├── system
│   ├── user
│   ├── assistant
│   └── tool
│
├── blocks: ContextBlock[]
└── metadata?
```

因此：

```text
ContextBlock
    ↓ 组成
ContextMessage
    ↓ 组成
AgentContext.messages
```

可以记：

> **Block 是内容原子，Message 是带 Role 的 Block 集合。**

---

# 3. `AgentTool`：协议无关的 Tool 表示

统一结构：

```text
AgentTool
├── name
├── description
├── parameters
├── rawDefinition?   ← 附件版本存在
└── cacheControl?
```

它解决的问题与 Message 类似：

> OpenAI、Anthropic 等 Provider 对 Tool 的 wire format 不完全相同，Injection 核心层不应该绑定某一种 Provider。

因此 Adapter 将它们转换成统一：

```text
AgentTool
```

### `rawDefinition`

附件版本中：

```text
rawDefinition
```

保留 Provider 原生 Tool Definition。

目的：

```text
原协议 Tool
    ↓ parse
统一 AgentTool
    ↓ Injection
统一 AgentTool
    ↓ serialize
原协议 Tool
```

在这个 round-trip 中避免 Provider-specific / Future Fields 丢失。

### `cacheControl`

主要用于保留 Anthropic：

```text
cache_control
```

避免 Context Injection 的：

```text
parse → modify → serialize
```

破坏上游 Prompt Cache 语义。

### 核心设计思想

> **统一公共字段，同时尽量保证 round-trip 不丢失原协议语义。**

---

# 4. `AgentContextMetadata`：请求的运行时身份证

`metadata` 不表示“用户说了什么”，而描述：

> **这究竟是哪一次请求。**

可以按职责分成几组。

## 4.1 协议 / 模型

```text
protocol
modelId
stream
```

描述：

```text
什么协议
什么模型
是否流式
```

---

## 4.2 Trace / 请求身份

```text
traceId
keyId
```

用于：

- 链路追踪
- 日志定位
- Key 关联

---

## 4.3 Agent 来源

```text
agentSource
requestPath
```

例如：

```text
claude-code
codebuddy
```

`requestPath` 还允许 Injector 根据 URL Marker 决定行为，例如代码注释中提到的：

```text
AssetReflectionInjector
→ hasAnalyseMarker
```

缺失时采用静默降级。

---

## 4.4 用户 / Memory Namespace 隔离

```text
userId
spaceId
```

可以重点记：

```text
userId
→ 哪个用户

spaceId
→ 该用户下面哪个 Memory Instance / Space
```

因此 Cache / Repo 的逻辑隔离大致是：

```text
User
 └── Space
      └── Cache / Memory
```

其中：

```text
无 userId
→ anonymous 或跳过 Injection Pipeline

无 spaceId
→ Repo 使用 _default
```

---

## 4.5 Session / Turn 隔离

```text
sessionKey
turnSeq
```

组合后唯一定位：

```text
某个 Session
+
其中第 N 个 Turn
```

还用于生成稳定的 Langfuse Turn Trace ID。

---

## 4.6 `readOnly`

这是 Cache 语义中很重要的字段。

正常主请求：

```text
cache miss
    ↓
hook.execute()
    ↓
得到内容
    ↓
self-heal PUT
    ↓
写回 Cache
```

FORK 类请求：

```text
readOnly = true
```

则：

```text
cache miss
    ↓
hook.execute()
    ↓
使用结果
    ↓
不写回 Cache
```

原因：

> FORK 的目的主要是复用主对话已有 Cache；如果 Fork Miss 后重新生成并写入，内容不一定与主对话 byte-level 一致，可能反而污染 Cache。

---

# 5. `AgentContext`：Injection Pipeline 的核心载体

这是整份文件最核心的数据结构之一。

```text
AgentContext
├── messages
│   └── ContextMessage[]
│
├── tools?
│   └── AgentTool[]
│
├── requestParams
│   └── model / temperature / max_tokens / ...
│
└── metadata
    └── AgentContextMetadata
```

可以直接记成：

```text
AgentContext
=
消息
+
工具
+
模型请求参数
+
运行时元数据
```

它的地位：

> **这是 Injection Pipeline 内部真正流转和修改的统一 Request Context。**

因此 Injection 核心逻辑不需要直接操作：

```text
OpenAI Request
Anthropic Request
```

而只需要面向：

```text
AgentContext
```

这是整个模块实现协议解耦的重要基础。

---

# 6. Injection 定位体系：固定坐标 + 动态语义坐标

这一份代码同时提供两套定位方式：

```text
InjectionPoint
+
Dynamic Anchor
```

---

# 7. `InjectionPoint`：固定逻辑位置

系统预定义：

```text
system.prefix
system.suffix
system.before_tools
system.after_tools

user.before
user.after
user.first_turn

tools.append
tools.prepend
```

可以分成三类：

```text
system.*
→ System Prompt

user.*
→ User Message

tools.*
→ Tool List
```

它提供的是：

> **稳定、协议无关、但粒度相对固定的逻辑坐标。**

例如：

```text
system.prefix
→ System Prompt 最前面

user.before
→ 最新 User Message 前

tools.append
→ Tool List 最后
```

`INJECTION_POINTS` 则保存所有合法值，供运行时 Validation 使用。

---

# 8. Dynamic Anchor：更细粒度的语义定位

固定 `InjectionPoint` 无法很好表达：

> “我要把 Memory 插到当前 Agent Prompt 的 Memory 区域里面。”

因此加入：

```text
SemanticSlot
+
AnchorRelation
+
AnchorTarget
```

---

## 8.1 `SemanticSlot`

预定义语义区域：

```text
persona
tools
skills
memory
knowledge
rules
task_context
```

但允许业务定义自定义 Slot。

最核心的思想：

> **Hook 描述的是“我要去哪个语义区域”，而不是“我要去 Claude/CodeBuddy 的哪个具体 Tag”。**

例如：

```text
slot = memory
```

不同 Agent 可以解析为：

```text
CodeBuddy
→ 某 XML Tag

Claude Code
→ 某 Markdown Heading

其他 Agent
→ 其他具体结构
```

转换由：

```text
AgentProfile.resolveSlot()
```

完成。

因此形成：

```text
统一语义 Slot
      ↓
AgentProfile.resolveSlot()
      ↓
Agent-specific Structural Key
```

---

## 8.2 `AnchorRelation`

找到目标区域之后，还要描述：

> 相对它插在哪里？

四种：

```text
before
after

inside_prepend
inside_append
```

图示：

```text
before
  ↓
[新内容]

┌────── target slot ──────┐
│ inside_prepend          │
│ ↓                       │
│ 原有内容                │
│ ↓                       │
│ inside_append           │
└─────────────────────────┘

[新内容]
  ↑
after
```

---

## 8.3 `AnchorTarget`

最终：

```text
AnchorTarget
=
定位哪个 Slot
+
相对 Slot 怎么插
```

例如：

```text
slot = memory
relation = inside_append
```

含义：

> 找到当前 Agent 的 Memory 区域，并追加到区域内部末尾。

---

## 8.4 `slot` 与 `rawKey`

推荐：

```text
slot
```

因为它：

```text
Agent-agnostic
跨 Agent 可移植
```

特殊场景：

```text
rawKey
```

可以直接指定某个 Agent 的具体：

```text
tag
heading
field
```

它是 Escape Hatch：

```text
slot
→ 更通用

rawKey
→ 更精确，但绑定具体 Agent
```

本质是：

> **Portability 与 Precise Control 之间的权衡。**

---

# 9. `HookPriority`：Hook 执行顺序

规则：

```text
数字越小
→ 优先级越高
→ 越先执行
```

预定义：

```text
SYSTEM   0
MEMORY   100
SKILL    200
WIKI     300
CUSTOM   1000
```

默认执行语义：

```text
SYSTEM
  ↓
MEMORY
  ↓
SKILL
  ↓
WIKI
  ↓
CUSTOM
```

这里故意使用：

```text
0 / 100 / 200 / 300 / 1000
```

而不是：

```text
0 / 1 / 2 / 3 / 4
```

很明显是在为未来留下插入空间，例如：

```text
50
150
250
```

可以增加新的 Hook 类型，而不需要整体重新编号。

需要重点记住：

> Priority 不仅影响“谁先把内容插进去”，还可能影响后续 Hook 看到的 `AgentContext`。

因为 `execute(ctx)` 接收到的 Context：

```text
可能已经被更早执行的 Hook 修改过。
```

---

# 10. `CacheStrategy`：Hook 内容生命周期

缓存策略共有三种：

```text
none
session_init
hybrid
```

---

## 10.1 `none`

```text
每次 Request
    ↓
execute(ctx)
```

不使用 Session Prewarm Cache。

适合：

> 强依赖当前 Turn 的动态内容。

---

## 10.2 `session_init`

```text
Session Init
    ↓
prewarm(input)
    ↓
生成 Block
    ↓
持久化 Cache

之后 Request
    ↓
直接读 Cache
    ↓
SKIP execute()
```

适合：

> 一个 Session 内稳定不变的内容。

例如代码注释中明确给出的：

```text
Skill List
根据 Task Description 得出的固定 Wiki Docs
```

---

## 10.3 `hybrid`

```text
Session Init
    ↓
prewarm()
    ↓
Cached Blocks

每个 Turn
    ↓
execute(ctx)
    ↓
Fresh Blocks

Cached + Fresh
      ↓
    去重
      ↓
最终 Injection
```

去重依据：

```text
metadata.cacheKey ?? content
```

优先根据 Cache Key；没有 Cache Key 时根据内容本身。

Hybrid 很适合：

> **Session Stable Context + Turn-level Dynamic Recall**

例如：

```text
固定用户 / 项目背景
+
当前 User Message 相关 Memory
```

---

# 11. `PrewarmInput`：Session Init 能拿到什么？

Prewarm 的核心限制必须重点记：

> **Prewarm 阶段没有 Current User Message。**

因此：

```text
prewarm()
→ Session-level Stable Context

execute(ctx)
→ Turn-level Dynamic Context
```

需要当前问题做 Recall 的 Hook：

```text
必须使用 hybrid
```

并继续在：

```text
execute()
```

中进行动态召回。

---

## PrewarmInput 信息结构

```text
PrewarmInput
│
├── 身份
│   ├── keyId
│   ├── userId
│   └── callerUserKey?
│
├── Agent / Memory Space
│   ├── agentSource
│   └── spaceId?
│
├── Session
│   ├── sessionInfo
│   ├── agentDetail
│   └── taskDetail
│
└── Asset Capability
    └── assetCapabilities?
```

---

## Asset Capability

```text
skill
llm_wiki
code_graph
chat_memory
```

用于表示：

> 当前用户哪些 Asset 能力处于可用状态。

Hook 可以据此决定是否准备对应内容。

---

## `callerUserKey`

用于 Session Init / Prewarm 调用下游服务时传递 Caller 身份，支持：

```text
TDAI ACL
```

这是敏感 Credential。

代码明确要求：

```text
只在内存流转
不写日志
不持久化
```

这一点属于重要安全约束。

---

# 12. `InjectionHook`：整个模块的核心插件协议

可以把 `InjectionHook` 理解成：

> **一个 Injection 插件必须遵守的统一 Contract。**

结构：

```text
InjectionHook
│
├── id
│   └── 我是谁
│
├── point
│   └── 固定 fallback 注入位置
│
├── anchor?
│   └── 动态精确注入位置
│
├── priority
│   └── 我什么时候执行
│
├── description
│   └── Debug / Logging 描述
│
├── cacheStrategy?
│   └── 我的内容生命周期
│
├── prewarm?()
│   └── Session 初始化准备
│
└── execute()
    └── Request 阶段生成内容
```

可以浓缩成六个问题：

```text
1. 我是谁？
   → id

2. 我要放哪里？
   → anchor / point

3. 我什么时候执行？
   → priority

4. 我的结果怎么缓存？
   → cacheStrategy

5. Session 初始化准备什么？
   → prewarm()

6. 当前 Request 要生成什么？
   → execute()
```

---

# 13. Anchor + Point：渐进增强 + Fallback

`point` 永远必填：

```text
point
→ 基础定位
```

`anchor` 可选：

```text
anchor
→ 高级动态定位
```

执行思想：

```text
是否匹配 AgentProfile？
        ↓
Semantic Slot 能否 resolve？
       / \
      /   \
    YES   NO
     ↓     ↓
 Anchor   point
 精确定位  fallback
```

因此：

> Dynamic Anchor 不会破坏旧 Hook。

老 Hook 可以完全不知道：

```text
anchor
```

依然正常工作。

这是整个文件中非常明显的：

> **Backward Compatibility / Additive Evolution**

设计。

---

# 14. `prewarm()` 与 `execute()`

## `prewarm()`

只用于：

```text
session_init
hybrid
```

在 Session Init 时准备 Cached Blocks。

失败或者没有实现时：

```text
静默降级
→ 无 Cached Blocks
```

目标是：

> 缓存增强能力失败时，不轻易拖垮整个 Agent 请求链路。

---

## `execute()`

是 Hook 最主要的运行入口。

输入：

```text
当前 AgentContext
```

注意：

> 它可能已经被前面的高优先级 Hook 修改过。

输出：

```text
ContextBlock[]
```

返回：

```text
[]
```

代表：

```text
本轮跳过注入
```

因此 Hook Pipeline 形成串行 Context 演化：

```text
AgentContext v0
      ↓
Hook A
      ↓
AgentContext v1
      ↓
Hook B
      ↓
AgentContext v2
      ↓
Hook C
      ↓
AgentContext v3
```

---

# 15. `HookRegistry`：Hook 管理中心

如果：

```text
InjectionHook
= 单个插件
```

那么：

```text
HookRegistry
= 插件管理器
```

提供：

```text
register(hook)
→ 注册 Hook

unregister(hookId)
→ 注销 Hook

getHooks(point)
→ 获取指定 InjectionPoint 下的 Hook
→ 按 Priority 排序

getAll()
→ 获取全部 Hook
```

所以 Registry 的职责是：

```text
管理
+
查找
+
组织 Hook
```

而不是执行具体 Injection。

Pipeline 则负责真正调度这些 Hook。

---

# 16. 从类型定义还原出的完整工作流

> 以下是根据 `types.ts` 中的接口和注释可以还原出的主干工作流；具体实现细节仍需要继续阅读 Pipeline、Adapter、Registry、Cache Repo 等实现文件确认。

## 阶段 A：协议标准化

```text
OpenAI / Anthropic Request
            ↓
         Adapter
            ↓
ContextBlock / ContextMessage
AgentTool
AgentContextMetadata
            ↓
       AgentContext
```

目标：

> 把 Provider-specific Request 转换成协议无关内部表示。

---

## 阶段 B：Session Init / Prewarm

对于：

```text
cacheStrategy =
session_init / hybrid
```

执行：

```text
PrewarmInput
     ↓
hook.prewarm()
     ↓
ContextBlock[]
     ↓
Hook Cache
```

这里生成的是：

> Session Stable Content。

---

## 阶段 C：Request Injection

每次请求：

```text
AgentContext
     ↓
HookRegistry
     ↓
找到相关 Hooks
     ↓
按照 HookPriority
排序执行
```

---

## 阶段 D：确定 Hook 数据来源

### none

```text
execute(ctx)
```

### session_init

```text
Cache
```

并跳过：

```text
execute()
```

### hybrid

```text
Cached Blocks
+
execute(ctx) Fresh Blocks
+
Dedup
```

---

## 阶段 E：确定 Injection 位置

优先：

```text
AnchorTarget
      ↓
SemanticSlot
      ↓
AgentProfile.resolveSlot()
```

成功：

```text
Dynamic Anchor 精确注入
```

失败：

```text
InjectionPoint fallback
```

---

## 阶段 F：Context 继续流转

```text
Hook A
↓
修改 AgentContext

Hook B
↓
读取已经修改后的 Context
↓
继续修改

...

最终 AgentContext
```

最后再由对应 Adapter：

```text
AgentContext
    ↓
serialize
    ↓
OpenAI / Anthropic Request
```

发送给真正的模型。

---

# 17. 整份文件最重要的 8 个设计思想

## ① Protocol-Agnostic Internal Representation

核心层不直接绑定 OpenAI / Anthropic。

统一：

```text
ContextBlock
ContextMessage
AgentTool
AgentContext
```

Adapter 负责协议差异。

---

## ② Hook Plugin Architecture

Injection 不是写死的一坨逻辑，而是：

```text
一个 Hook
一个职责
```

通过：

```text
InjectionHook
+
HookRegistry
```

形成可插拔架构。

---

## ③ 固定坐标 + 动态语义坐标

```text
InjectionPoint
→ 稳定 Fallback

SemanticSlot + AnchorTarget
→ Agent-specific 精确定位
```

兼顾：

```text
稳定性
+
精细控制
```

---

## ④ Agent-Agnostic Semantic Slot

Hook 不应该写：

```text
“插入 CodeBuddy 的 <xxx>”
```

而应该写：

```text
“我要进入 memory 区域”
```

真正 Agent-specific 的结构映射交给：

```text
AgentProfile.resolveSlot()
```

这是实现跨 Agent 复用的重要解耦层。

---

## ⑤ Deterministic Hook Scheduling

```text
HookPriority
```

显式定义 Hook 顺序。

避免：

> Hook 注册顺序偶然影响最终 Prompt。

同时后执行 Hook 可以明确基于前面 Hook 已修改过的 Context 工作。

---

## ⑥ 两种生命周期的 Context

这是 Cache Strategy 最核心的思想：

```text
Session-level Stable Context
→ prewarm
→ Cache

Turn-level Fresh Context
→ execute()
```

Hybrid 将两者组合。

---

## ⑦ Namespace / Conversation Isolation

通过：

```text
userId
spaceId
sessionKey
turnSeq
```

形成不同层级隔离：

```text
User
 └── Space
      └── Session
           └── Turn
```

这是 Memory / Cache 正确性的基础之一。

---

## ⑧ Backward Compatibility / Graceful Degradation

整个文件大量采用增量式设计：

```text
anchor?
cacheStrategy?
prewarm?
spaceId?
...
```

典型行为：

```text
没有 anchor
→ point fallback

没有 cacheStrategy
→ none

prewarm 失败
→ 无缓存内容，静默降级

没有 spaceId
→ _default
```

说明整个 Injection 模块比较强调：

> **增强能力可以逐渐加入，但不能轻易破坏已有请求链路。**

---

# 18. 一个最重要的架构图

```text
                     ┌─────────────────┐
                     │ External Request│
                     │ OpenAI/Anthropic│
                     └────────┬────────┘
                              ↓
                           Adapter
                              ↓
                     ┌─────────────────┐
                     │  AgentContext   │
                     │                 │
                     │ messages        │
                     │ tools           │
                     │ requestParams   │
                     │ metadata        │
                     └────────┬────────┘
                              ↓
                       HookRegistry
                              ↓
                    按 HookPriority 排序
                              ↓
                      InjectionHook
                              │
             ┌────────────────┼────────────────┐
             ↓                ↓                ↓
       CacheStrategy       execute()       prewarm()
             │                                  │
             ↓                                  ↓
      Cached / Fresh                     Session Cache
        ContextBlock                           │
             └────────────────┬─────────────────┘
                              ↓
                       ContextBlock[]
                              ↓
                    AnchorTarget 可用？
                         /          \
                       YES          NO
                        ↓            ↓
                  SemanticSlot   InjectionPoint
                        ↓          Fallback
                AgentProfile.resolveSlot()
                        \            /
                         \          /
                          ↓        ↓
                       注入 Context
                              ↓
                    下一 InjectionHook
                              ↓
                    Final AgentContext
                              ↓
                           Adapter
                              ↓
                             LLM
```

---

# 19. 快速复习表

| 类型 | 一句话记忆 |
|---|---|
| `ContextBlock` | 最小内容单元 |
| `ContextMessage` | Role + Blocks |
| `AgentTool` | 协议无关 Tool |
| `AgentContextMetadata` | 请求运行时身份证 |
| `AgentContext` | Injection Pipeline 的统一请求载体 |
| `InjectionPoint` | 固定注入坐标 |
| `SemanticSlot` | 跨 Agent 的语义区域 |
| `AnchorRelation` | 相对目标区域怎么插 |
| `AnchorTarget` | 动态语义定位指令 |
| `HookPriority` | 谁先执行 |
| `CacheStrategy` | Hook 内容什么时候生成/从哪里读 |
| `PrewarmInput` | Session Init 阶段 Hook 能拿到的信息 |
| `InjectionHook` | 一个完整 Injection 插件 |
| `HookRegistry` | Hook 注册与管理中心 |

---

# 20. 五句话背下整个 `types.ts`

如果以后只剩 30 秒复习，可以记：

> **① `AgentContext` 是 Context Injection 内部统一的一次 Agent Request。**

> **② `InjectionHook` 是插件：负责生成要注入的 `ContextBlock`。**

> **③ `HookPriority` 决定谁先执行；`CacheStrategy` 决定内容是每轮算、Session 预热还是两者结合。**

> **④ `AnchorTarget` 优先通过 Semantic Slot 精确定位；解析失败就 fallback 到固定 `InjectionPoint`。**

> **⑤ `HookRegistry` 管理所有 Hook，Pipeline 负责按顺序执行 Hook 并持续修改 `AgentContext`。**

最终主线：

```text
AgentContext
      ↓
HookRegistry
      ↓
HookPriority
      ↓
InjectionHook
      ↓
CacheStrategy
      ↓
prewarm / execute
      ↓
ContextBlock
      ↓
AnchorTarget / InjectionPoint
      ↓
修改 AgentContext
```

---

# 21. 阅读这份文件后，应该建立的核心认知

不要把 `types.ts` 理解成：

> “定义了一堆 TypeScript Interface。”

更准确的理解应该是：

> **它定义了整个 Context Injection 模块的领域模型（Domain Model）和插件协议。**

其中最核心的几个架构对象是：

```text
AgentContext
InjectionHook
HookRegistry
```

其他类型基本都在回答它们运行时所需要的几个问题：

```text
Context 是什么？
→ ContextBlock / ContextMessage / AgentContext

Hook 放哪里？
→ InjectionPoint / AnchorTarget

Hook 谁先跑？
→ HookPriority

Hook 的内容什么时候算？
→ CacheStrategy

Session 初始化时有什么信息？
→ PrewarmInput

Hook 怎么被管理？
→ HookRegistry
```

因此，这份文件可以看成后续阅读整个 `src/injection/` 模块时的**总地图**。

---

# 22. 版本提示

你当前附上的完整 `types.ts` 中，`AgentTool` 包含：

```text
rawDefinition?
```

用于在：

```text
parse → injection → serialize
```

过程中保留 Provider 原生 Tool Definition。

当前给出的 GitHub `feat/server_team` 链接中我读取到的版本没有这一字段。

因此后续继续读项目代码时，需要注意：

```text
本地 / 当前工作版本
≠
GitHub 该分支当前可见版本
```

如果后续分析 Tool Adapter、Tool round-trip 或相关测试，应该优先确认你实际开发分支中的 `types.ts` 版本。

