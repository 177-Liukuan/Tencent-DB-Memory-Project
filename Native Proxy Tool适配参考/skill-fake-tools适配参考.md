# Skill Fake Tool 的 Native Proxy Tool 适配参考

> 状态：初稿，仅供首轮实现与 A/B 评测参考
>
> 更新时间：2026-08-31
>
> 重要说明：本文不是最终接口规范。Tool Description、Schema、结果结构和限制参数可根据实际实现及评测结果调整。

## 1. 核心结论

Native 项目应实现现有十个 Skill 业务操作，但不再保留 `<skill_tools>`、Bash/curl 调用方式、兼容开关或回退路径。旧实现统一查阅 [Baseline Skill Tools Injector](../TencentDB-Agent-Memory-Baseline/MemoryProxy/src/injection/injectors/skill-tools-injector.ts)。

十个工具全部进入统一 Tool Registry，但“已经实现”不等于“当前向模型暴露”。每次请求由暴露策略生成可见子集，Dispatcher 执行时再做一次授权校验：

| 条件 | 模型可见工具 |
| --- | --- |
| `assetCapabilities.skill=false` | 不暴露 Skill Tool |
| Skill 开启、`allowLlmWrite=false` | 4 个：search、view、files_read、extract |
| Skill 开启、`allowLlmWrite=true` | 全部 10 个 |

`skill_extract` 会触发会话归档和异步抽取，具有副作用；首版为保持现有行为仍在只读配置下暴露，但 Registry 必须将其标记为 `archive`，不能归类为纯读取。

## 2. 十个工具及模型参数

| 工具 | 模型提供的主要参数 | 暴露条件 |
| --- | --- | --- |
| `skill_search` | `query` | Skill 开启 |
| `skill_view` | `skill_id` | Skill 开启 |
| `skill_files_read` | `skill_id`、`path`、可选 `encoding` | Skill 开启 |
| `skill_extract` | 可选 `reason` | Skill 开启 |
| `skill_create` | `name`、`content`、可选 `resources` | `allowLlmWrite=true` |
| `skill_update` | `skill_id`、`content` | `allowLlmWrite=true` |
| `skill_patch` | `skill_id`、`old_string`、`new_string`、可选 `replace_all` | `allowLlmWrite=true` |
| `skill_delete` | `skill_id` | `allowLlmWrite=true` |
| `skill_files_write` | `skill_id`、`files` | `allowLlmWrite=true` |
| `skill_files_remove` | `skill_id`、`paths` | `allowLlmWrite=true` |

`skill_list` 当前已经下线，不属于这十个工具；Agent 自带 Skill 仍通过 `<available_skills>` 目录展示。

## 3. 职责重新分配

| Fake Tool 中的内容 | Native Proxy Tool 中的处理 |
| --- | --- |
| 十个 `<tool>` 文本块 | 改为十个原生 Tool Schema |
| curl、Bridge URL、Header | 删除，由 Dispatcher 内部补充 |
| `user_id`、`team_id`、最终 `agent_id` | 从可信 Session 和资产权限中解析 |
| 工具用途和字段说明 | 精简到 Tool Description 与 JSON Schema |
| 4/10 工具暴露控制 | 由统一 Exposure Resolver 实现 |
| 所有权、ACL、写权限 | Dispatcher 与 Skill Bridge 双重校验 |
| `expected_version` | 由 Proxy 的 Session Version Pin 补充 |
| HTTP 错误码与信封 | 转换为精简、稳定的 Tool Result |
| Bash/curl 下载说明 | 删除，明确 Native Tool 的文件返回边界 |

推荐的 Registry 元数据包括：工具名称、Description、Schema、Bridge 路由、暴露策略、副作用类型、超时、最大结果大小和 Result Mapper。Tool Definition 只表达模型决策所需信息，URL、鉴权和身份不发送给模型。

## 4. 首版执行链路

```text
Skill Tool Registry（完整 10 工具）
        ↓
SkillToolExposureResolver（生成 0 / 4 / 10 工具子集）
        ↓
NativeSkillToolsInjector → tools.append
        ↓
Anthropic / OpenAI Protocol Adapter
        ↓
模型生成原生 Tool Call
        ↓
Dispatcher：授权复核、Schema 校验、版本与身份补充
        ↓ HTTP
Skill Bridge → MemoryCore Skill API
        ↓
标准化 Tool Result
        ↓
消息回填与 Internal Re-entry
```

读取工具可以并行；写工具应按目标 Skill 串行，`skill_extract` 应按 Session 串行，并使用 `tool_use_id` 作为幂等依据，避免网络重试或模型重入造成重复创建、修改、删除或抽取。

## 5. 必须同步修正的接口问题

### 5.1 Skill 定位

当前 `skill_search` 可以返回其他 Agent 的团队 Skill，而旧 `skill_view` 使用当前 Agent 下的 `skill_name` 调用 `get-by-name`，存在跨 Agent 路由歧义。首版建议让 `<available_skills>` 和 `skill_search` 都返回 `skill_id`，`skill_view` 统一按 `skill_id` 读取；Proxy 在服务端解析真实 owner agent 并重新校验权限，模型不能直接指定最终 `agent_id`。

### 5.2 版本锁

MemoryCore 的 update、patch、delete、files_write 和 files_remove 都需要 `expected_version`。该字段不必暴露给模型：`skill_view`/`skill_search` 记录 Session 固定版本，写操作由 Dispatcher 自动补充；尚未读取 Skill 时返回可恢复错误，要求模型先调用 `skill_view`。当前遗漏版本补充的 `skill_delete` 也必须纳入该逻辑。

### 5.3 文件读取

Native Proxy Tool 的结果会进入模型上下文，不能等价复刻客户端 `curl -o` 直接写工作区。首版只返回受大小限制的文本或 base64 内容；超限时返回文件元数据和 `content_omitted=true`。如需保存到工作区，由模型重入后调用 Claude Code 的 Client Tool 完成。

## 6. `<available_skills>` 的性质与适配

### 6.1 当前是什么

`<available_skills>` 不是 Tool，也不包含完整 `SKILL.md`；它是当前 Agent 的云端 Skill 目录，用名称和简短描述帮助模型判断是否值得继续调用 `skill_view`。当前实现见 [Baseline Skill Injector](../TencentDB-Agent-Memory-Baseline/MemoryProxy/src/injection/injectors/skill-injector.ts)，目录由 MemoryCore `/v3/skill/listing` 生成：

| 行为 | 当前实现 |
| --- | --- |
| 资产范围 | 当前 `team_id + agent_id` 名下的 Skill；团队其他可访问 Skill 由 `skill_search` 发现 |
| 选择方式 | Session Init 时根据 Agent/Task 描述构造查询；弱查询退化为列表头部 |
| 默认规模 | `searchTopK` 默认 20，字符预算默认 8,000 |
| 文本形态 | `<available_skills>` 内每行 `- name: description` |
| 生命周期 | `session_init` 缓存，同一 Session 后续请求复用；缓存缺失时实时重建 |
| 降级方式 | 身份缺失、Core 失败或列表为空时不注入，不阻断主请求 |

MemoryCore 的结构化返回其实还包含 `skill_id`、`version` 和 `name`，但当前注入文本只保留名称和描述，见 [listing handler](../TencentDB-Agent-Memory-Baseline/MemoryCore/src/gateway/skill-handlers.ts)。旧 `SkillInjector` 又在目录外包裹了强制加载、Bash/curl、`skill_patch` 和 `skill_create` 等引导，因此它当前同时承担“资产目录”和“工具使用说明”两种职责。

### 6.2 Native 项目如何处理

Native 项目应保留 `<available_skills>` 作为动态 System Context，不应把目录条目复制进 Tool Schema：Tool Schema 表达稳定能力，目录表达每个 Session 不同的资产数据；混在一起会导致工具定义频繁变化、增加 Token，并削弱 Prompt Cache 稳定性。

Native 中可以继续复用 `SkillInjector` 的 Session Init 查询、缓存和失败降级机制，但把它收敛为纯目录注入器：

1. 删除 Bash/curl、Bridge URL、Header 和“这些不是本地工具”等说明；
2. 删除对当前不可见写工具的固定引导，根据 Exposure Resolver 决定是否出现创建、修改和删除策略；
3. 为支持统一按 `skill_id` 调用 `skill_view`，建议把目录行调整为 `- [skill_id] name: description`；版本号无需进入 Prompt，继续由 Proxy 内部管理；
4. 目录为空时仍不注入该块，但 `skill_search` Native Proxy Tool 继续存在，使模型可以按需发现团队 Skill；
5. 目录是 Session 快照，新建或更新 Skill 后如需立即刷新，沿用 Session Refresh / `mem:sync`，不在每轮重新查询。

候选 Native 形态为：

```text
检查下方可用 Skill；若与任务相关，调用 skill_view 加载完整内容。
当前目录不足时，使用 skill_search 检索团队 Skill。
只有写工具实际可见时，才创建、修改或删除 Skill。

<available_skills>
- [skl-xxx] deployment-sop: 项目部署和故障恢复流程
- [skl-yyy] review-guidelines: 团队代码审查规范
</available_skills>
```

是否保留“强制加载”措辞应通过两组实验判断：Native-A 仅使用 Tool Schema 与 Skill 目录；Native-B 额外加入上述短策略。重点比较有效调用率、误调用率、工具选择正确率和 Token。

## 7. 最小代码改造

1. 删除 Native 中 `SkillToolsInjector` 的 `<skill_tools>` Fake Tool 注入和注册；
2. 建立包含十个定义的 Skill Tool Registry；
3. 增加 Exposure Resolver 和薄层 `tools.append` Injector；
4. 改写 `SkillInjector` 的 curl/写工具引导，并让目录提供稳定 Skill 标识；
5. Dispatcher 通过 HTTP 复用现有 Skill Bridge，身份、ACL、版本和鉴权全部由服务端控制；
6. 统一成功与错误 Tool Result，并限制资源内容大小；
7. 为 0/4/10 三种暴露状态、十个执行器、权限拒绝、版本过期、幂等和结果回填建立测试。

首版的目标是完成十个 Skill 能力的原生工具表达、可控暴露和可靠执行，不同时重构 Skill 后端业务。本文中的字段和策略仅供参考，正式实现以源码契约、协议测试和评测结果为准。
