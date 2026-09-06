# Skill 提示词第一版优化：原 30 题复测报告

## 1. 结论

第一版改善了 Skill 题，但尚未达到总体工具选择正确率与 Baseline 持平的目标。

本次 Native 的 Skill 选择正确率为 **90%（9/10）**，高于本轮 Baseline 的 **80%（8/10）**，也高于上轮 Native 的 50%。但 Native 的 Memory 选择正确率从 70% 降至 40%，总体只从 60% 提升到 65%，仍低于本轮 Baseline 的 75%。

| 指标 | 上轮 Baseline | 上轮 Native | 本轮 Baseline | 本轮 Native |
|---|---:|---:|---:|---:|
| 正样本有效调用率 | 100%（20/20） | 100%（20/20） | 100%（20/20） | 100%（20/20） |
| Memory 工具选择正确率 | 60%（6/10） | 70%（7/10） | 70%（7/10） | 40%（4/10） |
| Skill 工具选择正确率 | 90%（9/10） | 50%（5/10） | 80%（8/10） | 90%（9/10） |
| 总体工具选择正确率 | 75%（15/20） | 60%（12/20） | 75%（15/20） | 65%（13/20） |
| None 误调用率 | 60%（6/10） | 40%（4/10） | 50%（5/10） | 50%（5/10） |
| 固定工具说明与 Schema Token | 4,073 | 1,667 | 4,073 | 1,871 |

本轮两组 None 误调用全部属于 Skill：Skill 误调用率均为 50%，Memory 误调用率均为 0%。Native 的静态说明增加 204 Token，仍比 Baseline 少约 54.06%。统计使用原有 `cl100k_base` Tokenizer，不等于整个请求的服务商计费 Token。

## 2. 这次改了什么

Native 仅修改 [skill-injector.ts](../../TencentDB-Agent-Memory-Native/MemoryProxy/src/injection/injectors/skill-injector.ts) 中 `wrapAvailableSkillsBlock()` 使用的静态说明：

- 回复前先浏览 Skill 目录；匹配或部分相关时，必须调用 `skill_view` 加载。
- 恢复“即使已经会做，也应读取 Skill”的使用动机：专门知识、验证过的流程、项目惯例和质量标准。
- 优先使用当前 Agent 已关联的 Skill，不够时再搜索团队 Skill。
- 保留真工具读取方式，不恢复 Bash/curl、Bridge URL，也不加入未开放的修改、创建工具指令。
- 工具未开放时仍只展示参考目录，不要求模型调用不存在的工具。

没有修改 Memory 提示词、任何 Tool Schema、工具描述、执行与恢复逻辑、任务标签、评分函数或观测停止条件。Baseline 源码未改。两组 Proxy 已重启加载代码；实验期间项目代码没有变化。

[实际提示词检查](../results/pilot-2026-09-06T12-12-27-148Z/prompt-v1-smoke.json) 记录了已发送给模型的说明。
[Skill 输入核对](../results/pilot-2026-09-06T12-12-27-148Z/skill-prompt-audit.json) 覆盖 10 题 × 两组：目标 Skill 全部在实际目录中，两组目录正文和顺序相同，强制加载要求均存在。因此，本轮差异不能用“Native 没注入目标 Skill”来解释。

## 3. 实验如何控制变量

- 原实验：`pilot-2026-09-05T18-38-31-734Z`。
- 本次实验：`pilot-2026-09-06T12-12-27-148Z`。
- 使用原实验冻结的 30 条任务，Memory、Skill、None 各 10 条；任务文件逐字一致，没有重新抽题或修改标签。
- 使用冻结的工作区、Skill 正文及资源、原独立 builder 生成的 L0/L1/L2/L3；没有重新提炼 Memory，没有复用运行后已积累新数据的 Agent。
- 两组共 60 个新 Agent、60 个独立 Session、60 个独立账号；每次运行复制工作区，不修改冻结资产。
- 同一任务的两组 Memory、Skill、Assets 配对核对通过，30 份来源种子版本均与上轮一致。
- 重复导入需要更换 Core 全局唯一的 Memory 记录 ID。两组使用相同映射，记录、索引及场景中的 ID 引用同步更新；业务内容和时间保留。这是内部编号变化，不应表述为新旧数据库每个字节完全相同。
- 相同容器镜像、模型 `deepseek-v4-flash[1m]`、权限、180 秒单题上限及交替运行顺序；检索继续使用原 BM25，embedding 为 `none`。
- 按用户要求使用当前 Claude Code **2.1.263**，60 份 CLI 初始化记录均确认这一版本；上轮为 2.1.261。因此，新旧差异不能全部归因于提示词。本轮 Baseline/Native 之间客户端版本相同。
- CLI 继续设置 `MAX_THINKING_TOKENS=0` 和 `alwaysThinkingEnabled=false`；这不等于证明自定义上游完全没有内部推理。
- 观测方式仍为真实 Bridge 埋点，不 Mock 工具结果。达到首个 Proxy Tool 观测点停止；没有 Proxy Tool 时等待正常回答。不会为了完成后续 Coding 而继续等待。

实际任务运行时间为 2026-09-06 12:15:58—12:37:47 UTC，约 21.83 分钟，不含准备。60 次观测全部有效，50 次到观测点停止，10 次正常返回最终回答；没有超时或运行错误。此模式不统计完整任务端到端延迟，也没有验收最终代码是否正确。

[配对数据](../results/pilot-2026-09-06T12-12-27-148Z/data-preparation.json)、
[运行核对](../results/pilot-2026-09-06T12-12-27-148Z/pipeline-audit.json)、
[汇总指标](../results/pilot-2026-09-06T12-12-27-148Z/summary.json)、
[静态 Token](../results/pilot-2026-09-06T12-12-27-148Z/static-token-check.json)。

## 4. 为什么 Skill 改善，而总体仍未持平

### 4.1 四条 Skill 题从先查 Memory 改为先读 Skill

Native 以下四题由上轮“选择不符”变为“符合预期”，没有原本正确的 Skill 题退步：

| 任务 | 上轮 Native 首次调用 | 本轮 Native 首次调用 |
|---|---|---|
| skill_043_api-auth-security：OAuth 回调 | tdai_memory_search | skill_view |
| skill_085_observability-performance：k6 基准 | tdai_read_scene | skill_view |
| skill_052_testing-bugfix：解析器边界测试 | tdai_read_scene | skill_view |
| skill_071_browser-automation：CDP 性能日志 | tdai_read_scene | skill_view |

这与“恢复 Skill 使用动机后，更容易先读取方法和流程”的预期一致。但这里只判断工具名称与首次选择，不证明读取了正确的 Skill 参数、参考文件或完成了任务。

唯一未通过的是 `skill_003_node-typescript-api`：“新增一个带运行时校验、类型安全错误和单元测试的订单详情接口。”两组本次都先调用 `tdai_read_scene`，而标签允许的是 `skill_search / skill_view`。因此它仍按原规则判错。先确认项目约定再读 Skill 是否合理，值得后续单独复核；本次不改标签，也无法从首个观测点推断后续完整调用过程。

### 4.2 Memory 题出现了偏向 Skill 的现象

Native 本轮 6 条选择不符的 Memory 题中：

- 5 条首先调用 `skill_view`；
- 1 条首先调用 `tdai_scenario_ls`，不在该题允许的首次工具中。

其中，CLI 参数与退出码、Redis 故障复盘策略、Postgres 团队评审配套 SQL 三题，从上轮正确的 Memory 查询改成了 Skill 读取。它们都与某个 Skill 的技术主题相关，但按标签要求，首先缺少的是项目过去的决定或约定，而不是通用操作方法。

“部分相关就必须加载”加强了 Skill 的存在感，却没有明确它与 Memory 的选择边界。这个解释符合本轮变化，但不能把每一条波动都归因于这一句话：例如 Python 依赖提交题从 `tdai_memory_search` 变成 `tdai_scenario_ls`，并不是转向 Skill；订单响应包装题则从目录查询变为 `tdai_read_scene`，反而通过了。

总体上，Native 在 Skill 题多对 4 条，在 Memory 题净少对 3 条，20 条正样本只净增加 1 条正确选择。

### 4.3 更强的 Skill 要求也会触及 None 负例

本轮 Native 的 None 误调用率为 50%，比上轮高 10 个百分点，与本轮 Baseline 持平。例如：

- 仅把 `BUSINESS_TOOLS` 类型断言拆成辅助函数；
- 仅增加 `clampAttempt(value,min,max)` 及边界测试。

这类任务按现有标签无需 Proxy Tool，但“部分相关也必须加载”容易让模型因为技术主题相关而读取 Skill。这里存在提示词要求与负例判定之间的张力，不是工具执行失败。

## 5. 下一版建议

第一版值得保留的是 **Skill 的使用动机**，不是继续加强所有场景下的强制程度。下一版优先做一处小调整：

> 需要确认既有事实、历史决定和项目约定时，先用 Memory；需要完成任务的方法、步骤或参考实现时，读取适用 Skill。不要仅因为涉及同一技术栈，就把局部修改视为必须加载 Skill。

这只是后续建议，本次没有继续修改。下一轮仍应同时检查 Memory、Skill 和 None，不以提高 Skill 分数为唯一目标。

另外应复核少数任务的合理首次工具范围，尤其是“先查询项目约定、再使用实现流程”可能合理的任务；复核依据应是任务信息需求，而不是模型本次选了什么。不能通过事后放宽标签美化结果。

## 6. 准备阶段发现的问题与处理

| 问题 | 处理 |
|---|---|
| 原 Pipeline 每次重新提炼 Memory，无法严格重跑冻结输入 | 增加可选 `reuse_preparation`，直接读取原任务、资产和 builder 数据；仍新建两组身份 |
| 旧 Memory 记录 ID 已存在于同一 Core，直接复制违反全局主键唯一性 | 仅在重跑时更换内部 ID，记录、索引和场景引用同步；两组映射一致 |
| ID 换号后排序变化使内容校验误报不一致 | 预期数据按新 ID 排序，与 SQL 读回顺序一致；测试复现后修复 |
| SQLite 可能有已提交 WAL 数据 | 使用 SQLite backup 复制冻结数据库，不只复制主文件 |
| Team 达到默认 100 上限 | 两组评测实例配置统一调整到 500；不改项目源码或 Memory 调度 |
| Claude Code 已自动升级 | 最终按用户要求两组统一使用 2.1.263，记录与上轮差异 |

准备阶段中止的尝试没有开始任务模型评测，未混入统计。其未使用 Team 也已清理：Baseline 19 个、Native 18 个。

按用户要求，两组各删除 51 个更早的 Team。上轮及本轮各 30 个 Team 均保留。删除使用项目已有操作，连同关联 Agent、Task 和资产登记清理；未额外删除底层 Memory/Skill 文件或评测证据。历史 Team 的元数据已有备份：
`/storage1/liukuan/tencentdb-memory-lab/run/eval-quota-2026-09-06T12-11-04-479Z`。
如需恢复，应按目标记录恢复，不能覆盖现在的整库。

测试：Native 类型检查通过，53 个测试文件、481 项测试通过，真实 ClickHouse 测试已开启且无跳过；eval_kit 类型检查通过，40 个测试文件、175 项测试通过。冻结数据另做了 30 份实际 SQLite 复制预检。以上没有修改两组工具核心逻辑。

## 7. 完整逐题对照

下表仅列已观测的 Proxy Tool 顺序。正例的 ✓ 表示首次工具符合原标签；负例的 ✓ 表示未调用 Proxy Tool。不表示 Coding 成功或工具参数全部正确。

| 任务 | 上轮 Baseline | 上轮 Native | 本轮 Baseline | 本轮 Native |
|---|---|---|---|---|
| memory_008_python-fastapi | tdai_read_scene ✓ | tdai_memory_search ✓ | tdai_read_scene ✓ | tdai_scenario_ls ✗ |
| memory_099_memory-proxy-evaluation | tdai_memory_search ✓ | tdai_read_scene ✓ | tdai_scenario_ls ✗ | tdai_memory_search ✓ |
| memory_091_cli-file-processing | skill_view ✗ | tdai_memory_search ✓ | skill_view ✗ | skill_view ✗ |
| memory_033_redis-concurrency | skill_view ✗ | tdai_memory_search ✓ | tdai_conversation_search ✓ | skill_view ✗ |
| memory_003_node-typescript-api | tdai_read_scene ✓ | tdai_scenario_ls ✗ | tdai_memory_search ✓ | tdai_read_scene ✓ |
| memory_084_observability-performance | tdai_memory_search ✓ | tdai_memory_search ✓ | tdai_read_scene ✓ | tdai_memory_search ✓ |
| memory_027_postgres-migrations | tdai_memory_search ✓ | tdai_memory_search → tdai_memory_search ✓ | tdai_conversation_search ✓ | skill_view ✗ |
| memory_050_testing-bugfix | skill_view ✗ | tdai_scenario_ls ✗ | skill_view ✗ | skill_view → tdai_scenario_ls ✗ |
| memory_017_react-frontend | tdai_read_scene ✓ | tdai_scenario_ls ✗ | tdai_read_scene ✓ | skill_view ✗ |
| memory_081_document-rag | skill_view ✗ | tdai_memory_search ✓ | tdai_memory_search ✓ | tdai_read_scene → tdai_memory_search ✓ |
| skill_043_api-auth-security | skill_view ✓ | tdai_memory_search ✗ | skill_view ✓ | skill_view ✓ |
| skill_003_node-typescript-api | skill_view ✓ | tdai_scenario_ls ✗ | tdai_read_scene ✗ | tdai_read_scene ✗ |
| skill_085_observability-performance | tdai_read_scene ✗ | tdai_read_scene ✗ | skill_view ✓ | skill_view ✓ |
| skill_024_postgres-migrations | skill_view ✓ | skill_view → skill_view ✓ | skill_view ✓ | skill_view ✓ |
| skill_036_message-queue-workers | skill_view ✓ | skill_search ✓ | skill_view ✓ | skill_view ✓ |
| skill_029_redis-concurrency | skill_view ✓ | skill_view ✓ | skill_view ✓ | skill_view ✓ |
| skill_088_cli-file-processing | skill_view ✓ | skill_view ✓ | skill_view ✓ | skill_view ✓ |
| skill_052_testing-bugfix | skill_view ✓ | tdai_read_scene ✗ | tdai_conversation_search ✗ | skill_view ✓ |
| skill_008_python-fastapi | skill_view ✓ | skill_view → tdai_memory_search ✓ | skill_view ✓ | skill_view ✓ |
| skill_071_browser-automation | skill_view ✓ | tdai_read_scene ✗ | skill_view ✓ | skill_view ✓ |
| none_066_browser-automation | 无 ✓ | 无 ✓ | 无 ✓ | 无 ✓ |
| none_097_memory-proxy-evaluation | skill_view ✗ | tdai_memory_search ✗ | 无 ✓ | skill_view ✗ |
| none_052_cicd-release | 无 ✓ | 无 ✓ | skill_view ✗ | 无 ✓ |
| none_036_message-queue-workers | skill_view ✗ | skill_view ✗ | skill_view ✗ | skill_view ✗ |
| none_039_api-auth-security | tdai_read_scene ✗ | tdai_scenario_ls ✗ | 无 ✓ | 无 ✓ |
| none_047_testing-bugfix | 无 ✓ | 无 ✓ | 无 ✓ | 无 ✓ |
| none_028_redis-concurrency | skill_view ✗ | skill_view ✗ | skill_view ✗ | skill_view ✗ |
| none_004_node-typescript-api | 无 ✓ | 无 ✓ | 无 ✓ | 无 ✓ |
| none_012_python-fastapi | skill_view ✗ | 无 ✓ | skill_view ✗ | skill_view ✗ |
| none_061_docker-linux-ops | skill_view ✗ | 无 ✓ | skill_view ✗ | skill_view ✗ |

## 8. 复现与解读边界

运行：

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
npm run pipeline -- --config configs/skill-prompt-v1-30.yaml
```

[配置文件](../configs/skill-prompt-v1-30.yaml) 中 `reuse_preparation` 指向已冻结且准备完整的实验目录。启用后按该目录的原任务顺序重跑，不再使用 `per_family / sample_seed` 重新抽样；需要保留该目录的 cases、inputs、builder 和 pair-checks。每次命令会创建新的运行身份，不能复用上次已经运行过的 Agent。

数据复制实现见 [run.ts](../pipeline/run.ts)、[memory-seed.ts](../pipeline/memory-seed.ts)，回归检查见 [pilot-pipeline.test.ts](../tests/pilot-pipeline.test.ts)。评分代码未改。

限制：

1. 每类只有 10 题且每题只运行一次，一题就是 10 个百分点。本轮 Skill 高于 Baseline 只对应多对 1 题，不能据此宣布稳定优于 Baseline。
2. 新旧轮次客户端版本不同；未修改的 Baseline 分项成绩也有变化，因此不能把全部变化视为提示词的独立因果效果。
3. 这些题已经用于定位和优化提示词，属于调优复查集。后续应在未参与调优的任务上验证。
4. 指标采用 Bridge 到达顺序，不等于完整的模型生成顺序；停止之后的调用不参与本轮统计。
5. 首次调用工具名称正确，不等于选中了正确 Skill 内容、参数有效或业务执行成功。没有最终回答的观测停止任务不是运行失败，也不应计入端到端 Coding 延迟。
