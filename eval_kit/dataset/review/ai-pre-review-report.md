# 300条任务改写与独立预审报告

> 最新：45题双组实际输入复核后，正式数据为285题（Memory 69、Skill 141、None 75）；新增30题中7题已核对实际注入，23题仍待确认。见[45题标签复核与重算报告](pilot-45-label-review-report.md)。以下统计保留为历史记录。

> 本文保留首次审核时的300题统计。后续清理保留279题，剩余62题现已完成双组实际注入核对，当前为 Memory 42、Skill 162、None 75；见[最新核对记录](input-validation-62-report.md)。删除与补素材记录见[清理报告](task-cleanup-report.md)。审核 JSONL 的 `independent_review` 未改写，后续处理分别记在 `cleanup`、`input_validation` 中；下文“待确认”是首次审核时的历史状态。

日期：2026-09-06。此次只调整数据和审核展示，不运行评测，不修改 Baseline / Native 工具、提示词或指标公式。

## 1. 结果

300题均完成 Query 改写、独立预审、旧标签对照，并补充 `reason`。全部归入 Main，不再保留固定调用序列要求。

| 项目 | 数量 |
| --- | ---: |
| Memory 主类别 | 80 |
| Skill 主类别 | 142 |
| None | 78 |
| 正例 / 负例 | 222 / 78 |
| 主类别变化 | 45 |
| 正负标签变化 | 28 |
| 首次允许工具集合变化（不计排列） | 125 |
| 允许 Memory、Skill 两类合理入口 | 57 |
| 完成静态裁定 | 210 |
| 仍有待确认条件 | 90 |

类别变化为 Memory → Skill 17题、Memory → None 3题、None → Skill 25题。旧任务 ID 保留用于追踪，统计以 `tool_family` 字段为准，不能再从 ID 前缀推断类别。

**这不是“300题标签已经全部可靠”的结论。** 待确认任务保留当前候选标签，具体条件写入审核记录；正式冻结前仍需处理。当前加载器不会自动拦截这些任务，不能直接把全部300题当成已经通过验收的数据。

## 2. 实际审核过程

使用两个直接子 Agent：一个负责改写，一个负责独立预审，没有再派生子 Agent。

1. 改写者只读取原 Query 和中性编号下的工作区文件，不读取旧分类、允许列表和理由。300题逐条调整表达；发现原缺陷不存在时，改为素材确实支持的需求，不凭空添加“按历史约定”。
2. 固定改写后的材料，交给独立上下文。预审者读取中性 Query、工作区、完整15个 Skill、来源会话的完整内容，以及可用工具说明和共同调用规则。没有提供旧标签、旧结果、目标 Memory 引用或改写者分类。
3. 先保存300条独立结论，再对照原标签。主审逐条核查差异，69条记录另有明确裁定说明。对4条需要再次纠正 Query 的任务重新预审，保留初次结论，不覆盖历史记录。

审核记录保存输入文件清单、内容校验值和审核条件，便于追查当时依据；这些只是离线审核材料，没有加入运行流程或工具恢复机制。

## 3. 改了什么

### Query 和任务前提

所有300条 Query 都做了文字调整。初次改写中136条记录了范围澄清或前提调整；另有4条后续纠正，其中部分与前者重合。因此不能把本次全部改动称为“纯润色”。具体变化见每题的 `rewrite.scope_change`、`query_correction`。

典型处理包括：

- 本地同步逻辑没有异步失败问题：改成明确新增异步入口及测试，不再声称现有异步代码有 Bug。
- 实际只有 `MemoryRepository`：改成测试真实的保存、读取、清理行为，不再要求不存在的 PostgreSQL 仓库集成测试。
- 状态码映射、固定时钟等已经实现：围绕现有行为补测试或明确新增需求，不再要求重复修复。
- 未提供真实 OCR、Chrome 会话或发布差异：能够保持原意的调整为已有素材支持的任务；确实依赖外部输入的保留待确认，不伪造业务资料。

本次没有修改工作区源代码，也没有改写后台 Memory 事实或 Skill 正文。素材不一致主要通过纠正任务表述处理；无法这样解决的缺失输入仍列为风险。

### 标签和元数据

- 每题补充有依据的 `reason`，不再仅凭原类别推导允许列表。
- 正例使用 `allowed_first_tools`；负例保留空的 `expected_tools`，不写非空允许列表。
- 去掉固定序列要求，15条原 Probe 也转为首次调用评测。
- 57题接受跨类入口。主类别表示主要需求，不表示其他类别必然错误。
- 去掉旧 `candidate_skills` 筛选元数据，审核按完整15个 Skill 进行；本次没有重新执行导入。
- 更新相关 Skill、资源文件和 Memory 引用；5条“最先三项决定”的原始消息引用从 0、6、14 改为 0、2、4。

允许 `skill_search` 不代表已找到正确 Skill；允许 `skill_view` 也不代表读取了正确正文。当前指标仍只按工具名称评价选择，不增加参数正确率或任务成功率，也没有重算旧实验结果。

## 4. 仍需确认的条件

90题中75题涉及尚未验证的 L3 注入条件，其中62题仅记录这一类风险。后台存在某项历史事实，不代表执行模型一定需要再次调用工具：如果事实已经完整注入，应重新判断调用必要性。

其他问题可能与上述条件重叠：

| 问题 | 代表任务或范围 | 后续处理 |
| --- | --- | --- |
| 原始会话 ID 与导入后 ID 不一致 | memory_042、049、056、063、070 | 运行前核对实际 ID；此次不修改管线或核心工具 |
| 真实输入缺失 | memory_064、096、097、058；skill_067、069 | 补实际镜像锁定文件、协议代码、Git 历史或浏览器连接，不能靠猜测完成 |
| 需求依据不充分 | skill_023、028、074；memory_022、026、027、081、086 | 明确索引工作负载、业务键、状态变更、文档输入或统计窗口等 |
| 答案部分已在 Query / 工作区 | memory_020、050、055、061 | 不把 Memory 当成唯一必要入口 |
| None 与“部分相关 Skill 也应加载”存在边界 | none_037、075、093 | 确认字面检查、小型校验是否应按现有 Skill 规则计为正例 |
| 当前要求与历史限制冲突 | memory_013；skill_067 | 明确当前要求是否覆盖历史，或允许分批处理 |
| 工程实现有多解 | memory_048 | 明确组合限流与各维度独立限流要求，不能只凭类别判错 |

逐题完整待确认清单见下方附录，风险说明也保存在审核 JSONL 中。未运行实际注入检查，不能把这些静态判断当成端到端验证。

## 5. 展示和验证

Viewer 的任务详情新增独立“标注理由”区域，按文本显示，不能执行 HTML。`reason`、旧标签和审核文件不会加入 Claude 的任务输入；针对性测试检查运行参数仍只携带 Query。

验证结果：

- `npm run typecheck` 通过。
- `npm test`：43个测试文件、205项测试通过。
- 浏览器检查通过：300题数量、分类筛选、搜索、分页、Query / 理由展示、手机和平板布局、HTML 注入防护及读取失败重试。
- 数据检查覆盖300条审核记录对应关系、Main 分类、工具名称、引用、去标签输入清单和原始独立结论保存。

浏览器测试中发现新增理由区域复用了 Query 选择器，导致两块内容被同时匹配；已分开类名并复测通过。没有变更指标计算公式。

## 6. 文件和版本

- 正式任务：[tool_call_eval_v1.jsonl](../tasks/tool_call_eval_v1.jsonl)
- 逐题审核：[ai-pre-review.jsonl](ai-pre-review.jsonl)
- `independent_review`：初次盲审原记录；`re_review`：必要时的第二次盲审。
- `comparison`：与旧标签的差异；`final`：最终候选、风险和裁定说明。
- `final.status=needs_confirmation`：仍需处理，不能视为正式冻结。

原数据 SHA-256：`5ec72c51f3b98292765cca39bf112c65ac9879794001f07187c08f571d9d8aa0`。

本次数据 SHA-256：`e7101f28312fbaa49bcd01fc51cffdf893488bc8d27e61958af3432c1726b68f`。

本次未提交、未推送、未启动评测，保留仓库中其他工作的修改。

## 附录：90条待确认任务

风险可以重叠；原 ID 只用于追踪，不代表当前分类。

| 任务 | 待确认条件 |
| --- | --- |
| memory_001_node-typescript-api | 实际注入未验证 |
| memory_090_cli-file-processing | 实际注入未验证 |
| memory_070_docker-linux-ops | 会话 ID 对应 |
| memory_077_document-rag | 实际注入未验证 |
| none_093_cli-file-processing | 规则或需求冲突 |
| memory_076_browser-automation | 实际注入未验证 |
| none_037_message-queue-workers | 规则或需求冲突 |
| memory_014_python-fastapi | 实际注入未验证 |
| memory_060_cicd-release | 实际注入未验证 |
| memory_083_observability-performance | 实际注入未验证 |
| memory_097_memory-proxy-evaluation | 缺少实际输入 |
| memory_092_cli-file-processing | 实际注入未验证 |
| memory_021_react-frontend | 实际注入未验证 |
| memory_057_cicd-release | 实际注入未验证 |
| memory_066_docker-linux-ops | 实际注入未验证 |
| skill_074_document-rag | 需求依据不足 |
| memory_020_react-frontend | 答案部分已提供；实际注入未验证 |
| none_075_document-rag | 规则或需求冲突 |
| memory_096_memory-proxy-evaluation | 缺少实际输入；实际注入未验证 |
| memory_063_cicd-release | 会话 ID 对应 |
| skill_023_postgres-migrations | 需求依据不足 |
| memory_051_testing-bugfix | 实际注入未验证 |
| memory_036_message-queue-workers | 实际注入未验证 |
| memory_015_react-frontend | 实际注入未验证 |
| memory_035_redis-concurrency | 实际注入未验证 |
| memory_030_redis-concurrency | 实际注入未验证 |
| memory_048_api-auth-security | 多解 |
| memory_010_python-fastapi | 实际注入未验证 |
| memory_072_browser-automation | 实际注入未验证 |
| memory_050_testing-bugfix | 答案部分已提供；实际注入未验证 |
| memory_049_api-auth-security | 会话 ID 对应 |
| memory_099_memory-proxy-evaluation | 实际注入未验证 |
| memory_067_docker-linux-ops | 实际注入未验证 |
| memory_002_node-typescript-api | 实际注入未验证 |
| memory_071_browser-automation | 实际注入未验证 |
| memory_043_api-auth-security | 实际注入未验证 |
| memory_024_postgres-migrations | 实际注入未验证 |
| skill_028_postgres-migrations | 需求依据不足 |
| memory_013_python-fastapi | 规则或需求冲突；实际注入未验证 |
| memory_023_postgres-migrations | 实际注入未验证 |
| memory_065_docker-linux-ops | 实际注入未验证 |
| memory_003_node-typescript-api | 实际注入未验证 |
| memory_093_cli-file-processing | 实际注入未验证 |
| memory_018_react-frontend | 实际注入未验证 |
| memory_088_observability-performance | 实际注入未验证 |
| memory_079_document-rag | 实际注入未验证 |
| memory_022_postgres-migrations | 需求依据不足；实际注入未验证 |
| memory_098_memory-proxy-evaluation | 实际注入未验证 |
| memory_075_browser-automation | 实际注入未验证 |
| memory_094_cli-file-processing | 实际注入未验证 |
| memory_038_message-queue-workers | 实际注入未验证 |
| memory_074_browser-automation | 实际注入未验证 |
| memory_085_observability-performance | 实际注入未验证 |
| memory_026_postgres-migrations | 需求依据不足；实际注入未验证 |
| memory_029_redis-concurrency | 实际注入未验证 |
| memory_061_cicd-release | 答案部分已提供；实际注入未验证 |
| memory_005_node-typescript-api | 实际注入未验证 |
| memory_082_document-rag | 实际注入未验证 |
| memory_068_docker-linux-ops | 实际注入未验证 |
| memory_089_cli-file-processing | 实际注入未验证 |
| memory_056_testing-bugfix | 会话 ID 对应 |
| memory_055_testing-bugfix | 答案部分已提供；实际注入未验证 |
| memory_081_document-rag | 需求依据不足；实际注入未验证 |
| memory_011_python-fastapi | 实际注入未验证 |
| memory_080_document-rag | 实际注入未验证 |
| memory_007_node-typescript-api | 实际注入未验证 |
| memory_047_api-auth-security | 实际注入未验证 |
| memory_016_react-frontend | 实际注入未验证 |
| skill_069_browser-automation | 缺少实际输入 |
| memory_064_docker-linux-ops | 缺少实际输入；实际注入未验证 |
| memory_062_cicd-release | 实际注入未验证 |
| memory_028_postgres-migrations | 实际注入未验证 |
| memory_019_react-frontend | 实际注入未验证 |
| memory_037_message-queue-workers | 实际注入未验证 |
| memory_031_redis-concurrency | 实际注入未验证 |
| memory_078_document-rag | 实际注入未验证 |
| skill_067_browser-automation | 缺少实际输入；规则或需求冲突 |
| memory_008_python-fastapi | 实际注入未验证 |
| memory_040_message-queue-workers | 实际注入未验证 |
| memory_100_memory-proxy-evaluation | 实际注入未验证 |
| memory_025_postgres-migrations | 实际注入未验证 |
| memory_012_python-fastapi | 实际注入未验证 |
| memory_033_redis-concurrency | 实际注入未验证 |
| memory_004_node-typescript-api | 实际注入未验证 |
| memory_027_postgres-migrations | 需求依据不足；实际注入未验证 |
| memory_042_message-queue-workers | 会话 ID 对应 |
| memory_009_python-fastapi | 实际注入未验证 |
| memory_086_observability-performance | 需求依据不足；实际注入未验证 |
| memory_058_cicd-release | 实际注入未验证；缺少实际输入 |
| memory_017_react-frontend | 实际注入未验证 |
