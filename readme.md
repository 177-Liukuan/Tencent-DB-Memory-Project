# Tencent-DB-Memory-Project

TencentDB Agent Memory 课题研究与 A/B 评测工作区。当前采用任务一的第二条路线：将 System Prompt + Bash/curl 形式的 **Fake Proxy Tool** 改为模型原生结构化 **Native Proxy Tool**，比较调用表现、静态上下文成本和响应延迟。

这里是研究工作区，不是产品的单一源码仓库。根仓库管理研究资料、数据集和评测代码；上游参考、Baseline、Native 通过三个 Git submodule 管理，部署环境由独立 Lab 仓库维护。

## 1. 当前进展

更新日期：**2026-09-07**。

| 内容 | 当前状态 |
|---|---|
| Native 工具执行 | 已实现 Schema 注入、调用解析、Bridge 执行、结果回填、模型重入及 Native / Client 混合调用 |
| 工具范围 | 已实现 6 个 Memory、10 个 Skill、2 个 Knowledge 包装工具；实际开放受配置和权限控制 |
| 隐藏历史与压缩 | Claude Code 路径使用 Hooks、Turn Marker、长期 Tool Ledger 恢复历史，普通请求与压缩输入共用恢复逻辑 |
| 双环境与观测 | Baseline / Native 独立部署；Bridge 记录实际到达的资产工具调用，Langfuse 用于检查模型输入和链路 |
| 评测流水线 | 已支持完整 Skill 库导入、统一 Memory 底稿、独立 Agent / Task / Session / 工作区、批量运行及汇总 |
| 数据与实测 | 已完成多轮小样本和一轮 285 题双组运行；当前删改后的正式任务文件剩余 273 题，不等同于该轮冻结数据 |
| Viewer | 已提供数据集浏览、标签审核、同题有效配对指标、原始记录与调用详情 |
| 独立延迟实验 | 本机工作区已实现 5 题 × 每组 5 次的模式与页面衔接；尚未单独提交，也未进行该模式的真实 50 次测量 |

**工程闭环已具备，不代表 Native 在各项指标上已优于 Baseline。** 当前重点是核对标签与实际输入、保持对照公平，并区分工具选择、参数错误、执行异常及采集边界。历史报告记录当时的数据和配置，不应直接当成最新版数据集的结果。

## 2. 比较的两套方案

```text
Baseline：
Claude Code → 模型生成 Bash/curl → Claude Code 执行
            → MemoryProxy Bridge → 后端 → 返回客户端 → 模型继续

Native：
Claude Code → MemoryProxy 注入 tools → 模型生成结构化 Tool Call
            → MemoryProxy 执行 Bridge → 后端 → 回填模型
            → 最终回答或 Client Tool 调用交回 Claude Code
```

Native 化改变工具的表达和执行位置，不重写 MemoryCore / Skill / Knowledge 的业务能力。身份、鉴权与 Bridge 地址由代理处理，模型提供工具所需的业务参数。

对照实验尽量保留 Baseline 的工具用途、使用条件和语气，仅移除 Bash/curl、HTTP 等传输细节，将参数和用途迁移到 Schema。单独强化调用动机、增加限制或调整模型参数，都会引入额外变量，须与机制比较分开记录。

### 工具范围

| 分类 | 已实现的 Native 工具 |
|---|---|
| Memory | `tdai_memory_search`、`tdai_atomic_query`、`tdai_conversation_search`、`tdai_conversation_query`、`tdai_scenario_ls`、`tdai_read_scene` |
| Skill 查询与提取 | `skill_search`、`skill_view`、`skill_files_read`、`skill_extract` |
| Skill 写入（需额外开启） | `skill_create`、`skill_update`、`skill_patch`、`skill_delete`、`skill_files_write`、`skill_files_remove` |
| Knowledge 包装 | `tdai_knowledge_tools_list`、`tdai_knowledge_tool_call` |

`skill_extract` 会触发归档与异步提取，不是纯只读工具。Knowledge 已实现，但当前主评测仅统计 Memory / Skill。工具注册和参数以 [Native Registry](TencentDB-Agent-Memory-Native/MemoryProxy/src/native-proxy-tools/tool-registry.ts) 为准。

### 历史恢复与已知边界

Claude Code 保存它能看到的对话，MemoryProxy 额外保存隐藏的 Native 工具轨迹。短期 Runtime State 负责未完成调用与客户端续接；长期 Tool Ledger 负责后续请求的历史重建。通过 Turn、Round、Block、Call ID，以及前序 Client Tool 调用 ID，恢复调用位置和顺序。

`UserPromptSubmit` 标记真实用户轮次，`PreCompact` / `PostCompact` 记录压缩生命周期和 Epoch 切换。恢复时查询当前 Epoch，不再依赖 compact 英文关键词或整段前缀 Hash。模型如何取舍摘要信息仍由模型决定，代理应保证送入摘要模型前的工具历史完整。

当前代码包含 Anthropic Messages、Chat Completions、Responses 的工具解析与处理路径，但**不等于任意协议组合均受支持**。Claude Code 的长期恢复也不能推广为所有客户端都已具备。主要边界包括：

- 新 Session 的 branch/fork 不自动继承父 Session 的隐藏历史。
- Hook 缺失、Turn Marker 丢失或压缩状态不完整可能阻止恢复，应保留失败证据。
- 长期 Ledger 表当前没有实际 TTL，不能写成已按长期 TTL 自动清理。
- 协议路径与恢复行为需分别验证，不凭单条成功会话推断全部支持。

工程说明见 [技术复盘](Claude-Code-Native-Proxy-Tool工程技术复盘.md)，具体行为以当前源码和测试为准；该文档中的历史问题不代表都仍未修复。

## 3. 仓库与目录

| 路径 | 管理方式与职责 |
|---|---|
| [TencentDB-Agent-Memory/](TencentDB-Agent-Memory/) | 官方上游参考 submodule |
| [TencentDB-Agent-Memory-Baseline/](TencentDB-Agent-Memory-Baseline/) | Fake Tool 对照 submodule，包含已确认的兼容修复和评测埋点 |
| [TencentDB-Agent-Memory-Native/](TencentDB-Agent-Memory-Native/) | Native Proxy Tool 实现 submodule |
| [eval_kit/](eval_kit/) | 根仓库中的数据准备、评测、统计、Viewer 与测试 |
| [手稿/](手稿/) | 课题材料、导师讨论、研究记录 |
| [issues/](issues/) | 问题复现与修复证据 |
| [docs/](docs/) | 配套工程资料 |
| `tencentdb-memory-lab` | 指向本机 Lab 的符号链接，真实目录为 `/storage1/liukuan/tencentdb-memory-lab` |

Lab 是独立私有仓库：[TencentDB-Memory-Lab](https://github.com/177-Liukuan/TencentDB-Memory-Lab)。其 README 与 OPERATIONS 提供当前部署入口，旧报告已归档。数据库、密钥、会话、日志和恢复备份不入库。

### 获取源码与查看版本

```bash
git clone --recurse-submodules https://github.com/177-Liukuan/Tencent-DB-Memory-Project.git
cd Tencent-DB-Memory-Project
git submodule status
```

访问私有子仓库需要相应权限。根仓库提交中的 gitlink 是三个子仓库的检出依据。`workspace.lock.yaml` 仍包含早期部署快照，**尚未与当前版本同步，不应据此回退源码或 Lab**。本次只更新 README，不自动修改子模块指针或版本锁。

克隆不会恢复数据库、凭据、systemd 服务或本机 Lab 内容。换机器部署先按子项目安装文档和 Lab 说明准备环境，不覆盖已有同名目录或符号链接。

## 4. 评测数据与口径

当前 [任务文件](eval_kit/dataset/tasks/tool_call_eval_v1.jsonl) 共 **273 题**，按有效的首次调用规则派生分组：

| 分组 | 数量 |
|---|---:|
| Memory | 48 |
| Skill | 130 |
| Memory / Skill 双入口（Mixed） | 24 |
| None | 71 |

统计不按任务 ID 前缀或 `tool_family` 简单推断。`allowed_first_tools` 决定允许入口，`reason` 解释标签依据；审核理由和 Ground Truth 不应传入执行模型。

每个 Agent 导入配置目录中的完整 Skill 库，当前默认 15 个 Skill，`candidate_skills` 不再限制导入。每题两组使用同一份初始 Memory、Skill 和 Assets；Memory 在独立准备环境提炼一次，再复制给两组，缓存只复用干净底稿。Agent、Task、Session 和工作区副本均独立，避免上一轮修改或新记忆污染下一次运行。

**主比较只纳入双方观测有效、输入与评分规则一致的同题配对。** 无效的一侧不会被当作“未调用”，有效的另一侧仍保留原始记录。Mixed 不重复计入纯 Memory / Skill 组。

| 指标 | 当前口径 |
|---|---|
| 有效调用率 | 已调用的正样本数 / 正样本数 |
| 误调用率 | 发生调用的负样本数 / 负样本数 |
| 工具选择正确率 | 首次选对的正样本数 / 本组已调用正样本数 |
| 静态注入 Token | 工具相关固定提示词与 Native Schema，统一 Tokenizer 与统计范围；不计动态资产正文 |
| 端到端延迟 | 正式输入提交至完整最终响应，单独运行与汇总，不将首次观测停止时间当作完整响应延迟 |

调用统计使用 **Bridge 接收记录及其顺序**，不是所有模型刚生成的调用，也不代表业务执行成功。尚未到达 Bridge 的参数校验失败等可能不在记录中。Langfuse 用于核对实际提示词、工具定义、参数和上游链路，不作为当前主调用统计的唯一来源。

标签审核必须考虑当前上下文是否已包含答案、工具真实用途及多条合理入口，不能为了匹配某组表现反向修改答案。只按工具名称评分也不能证明参数正确或读到了目标 Skill。

详情见 [观测说明](eval_kit/docs/proxy-tool-observation.md)、[同题配对说明](eval_kit/docs/paired-valid-comparison.md)和[四类分组](eval_kit/docs/four-task-groups.md)。

## 5. 常用入口

### 本机服务与人工会话

以下命令要求本机部署已完成，不会自动创建凭据或恢复数据：

```bash
./tencentdb-memory-lab/bin/health-check
./tencentdb-memory-lab/bin/claude-baseline
./tencentdb-memory-lab/bin/claude-native
```

服务管理、SSH 转发及 Seed 恢复风险见 [Lab 运维说明](https://github.com/177-Liukuan/TencentDB-Memory-Lab/blob/main/OPERATIONS.md)。不要在正在评测时重启业务服务。

### 评测和 Viewer

```bash
cd eval_kit
npm ci

# 先按当前机器调整配置；执行后会准备数据并调用真实模型
bash run-pipeline.sh configs/pilot.example.yaml

# 可视化页面（本机默认 4173）
npm run viewer -- --results results --port 4173

# 只重算已有运行记录，不重新调用模型
npm run score -- --experiment results/EXPERIMENT_ID
```

注意：当前是四类分组，`per_family: 3` 会选 **12 题**，`15` 会选 **60 题**；`all` 选全部有素材的 Main 任务。旧配置名中的“30”“45”不保证等于当前执行题量。`reuse_preparation` 有意复用旧冻结题目，不能作为“使用最新数据”的入口。

结果保存在被忽略的 `eval_kit/results/`，包含配置、运行清单、逐次结果、原始事件与汇总。重新统计默认使用原运行记录中的标签，不会自动应用当前数据集的新标签。完整说明见 [Pipeline 使用说明](eval_kit/docs/pilot-pipeline.md)和[Viewer 使用说明](eval_kit/docs/viewer.md)。

### 开发验证

```bash
cd eval_kit
npm run typecheck
npm test

# Native 工具相关改动在对应组件中验证
cd ../TencentDB-Agent-Memory-Native/MemoryProxy
npm run typecheck
npm test
```

真实服务、ClickHouse、Hooks 和多协议会话验证需另外安排。不要把单元测试通过写成真实端到端全部通过。

## 6. 资料索引

- [任务一梳理](手稿/任务一梳理.md)：路线选择与课题边界。
- [课题介绍](手稿/参与的课题.题目介绍.md)：目标、方向和交付要求。
- [工程技术复盘](Claude-Code-Native-Proxy-Tool工程技术复盘.md)：主要实现与代码索引。
- [Native 固定注入提示词](Native-TDAI固定注入提示词.md)、[Baseline 固定注入提示词](Baseline-TDAI固定注入提示词.md)：提示词与工具定义对照，具体内容以源码为准。
- [9 题试跑](eval_kit/docs/pilot-9-task-report.md)、[30 题试跑](eval_kit/docs/pilot-30-task-report.md)、[45 题试跑](eval_kit/docs/pilot-45-20260906-report.md)：各轮环境、问题与结果，不合并为同一次实验。
- [项目协作与代码开发规范](项目协作与代码开发规范.md)：模块边界、注释、测试与提交要求。
- [Native 项目中文说明](TencentDB-Agent-Memory-Native/README_CN.md)、[安装指南](TencentDB-Agent-Memory-Native/INSTALL_CN.md)：产品使用与部署文档。

## 7. 安全与实验纪律

- 不提交密钥、真实运行配置、数据库、会话或未经脱敏的原始 Trace。
- Baseline / Native 的业务源码、端口、数据和 Claude 配置分开管理；评测期间不改工具核心实现。
- 工具描述或提示词优化、模型版本变更与调用机制变化分别记录，避免混淆因果。
- 不把“后台存有 Memory”视为“模型必须再次调用工具”；先核对实际注入内容。
- 数据集、代码、模型、配置、初始资产及评分规则均须留存版本依据。
- 恢复 Seed 会替换活跃数据并中断服务，不能当成普通清理命令。
- 区分已实现、已测试、真实实测、待确认与未提交工作，不将历史方案当成当前代码。

## 8. AI Agent 协助运行程序的长期通用约定

当刘宽要求“运行、启动、部署、重启或帮我把程序跑起来”时，AI Agent 默认完成整个运行闭环，而不是只给一条命令。该约定适用于本工作区及后续其它项目，不限于 TencentDB Agent Memory。

标准顺序如下：

1. **先确认环境**：阅读项目 README、运行手册和现有脚本，核对代码路径、分支/版本、依赖、端口、已有进程、数据目录和可用资源；能够从机器上确认的信息不再反问用户。
2. **先给出命令和简要注释**：命令使用可复制的代码块，说明每条命令的作用、运行目录和必要前提；涉及停止服务、覆盖配置、清理数据或外部访问时明确影响。
3. **代为运行**：用户明确要求“帮我运行/启动”即授权在该程序范围内执行正常启动操作。优先复用项目已有的 `systemd`、Docker Compose、启动脚本或 `screen`，不另造一套并行运行方式。
4. **验证真实可用**：启动后检查进程/服务状态、监听端口、健康接口和关键日志；不能只看到 PID 或 `active` 就宣称成功。若失败，先定位根因，再给出和执行最小修复。
5. **交付使用方法**：说明如何访问或调用程序、浏览器 URL、账号/凭据的安全查询路径、日志位置，以及查看状态、重启和停止的命令。需要从 Windows 访问服务器回环端口时，提供可直接复制的 PowerShell SSH 端口转发命令。
6. **长任务可恢复**：训练、下载、批处理等长任务应放入项目约定的后台管理工具（默认优先 `screen` 或现有服务管理器），并报告会话名、日志和重新进入方法。

长期安全约束：

- 不在回复、README、命令示例或日志摘要中暴露 API Key、Token、密码和私有凭据，只说明凭据文件或安全查询方式；
- 不停止或改动无关服务，不使用宽泛的 `pkill`，端口冲突时先识别占用者；
- 不覆盖用户已有修改、运行数据或配置；`purge`、删除数据、重置数据库等破坏性操作必须另行获得明确授权；
- 启动结果必须以当次新鲜检查为依据，并明确区分“服务器端已验证”和“仍需用户在本地验证”的部分。

用户可用下面的简写触发这一流程：

```text
请帮我在 <项目路径> 运行 <程序或服务>：先给出带简要注释的命令，然后代为启动并验证，最后告诉我访问、日志、重启和停止方法。
```


---

本 README 是研究工作区入口，不替代各子项目的产品文档。运行前以当前源码、配置与新鲜检查结果为准。
