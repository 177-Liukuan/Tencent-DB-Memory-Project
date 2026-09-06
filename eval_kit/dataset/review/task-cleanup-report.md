# 任务清理与素材补齐

> 后续更新：本报告中的62题已经完成双组实际注入核对，25题据此改为24题 Skill、1题 None。当前279题为 Memory 42、Skill 162、None 75，详情见[最新核对记录](input-validation-62-report.md)。下文保留清理阶段当时的数量和检查情况。

2026-09-06。本次接续独立预审，不重新生成记忆、不运行评测、不修改两组工具或评分公式。

## 当前结果

正式数据由300题减为279题：Memory 67、Skill 138、None 74，全部 Main。217题完成静态裁定，62题仍需检查实际注入内容；45题保留跨 Memory / Skill 的合理首次工具路径。

- 移出21题：1题与另一题操作和信息需求重复，20题存在需求、标签边界或真实环境缺失问题。
- 为3题补充4个文件；其中2题因本地已能获得相关信息，从 Memory 主类别调整为 Skill。
- 5条已知会话读取题接入运行时 ID 替换。
- 剩余62条风险均为“任务所需答案是否已经自动提供给模型”，留待真实数据准备和注入检查。

移出只是从正式 JSONL 删除任务条目，**没有删除工作区、Memory、Skill 或原盲审记录**。可以依据审核记录恢复任务，不影响旧实验文件。`review/ai-pre-review.jsonl` 仍有300条，`cleanup` 保存本轮处理原因及处理前结论，`independent_review` 不变。补素材后的主审复核没有冒充新一轮独立盲审。

## 补充的素材

| 任务 | 文件 | 处理说明 |
| --- | --- | --- |
| memory_064_docker-linux-ops | `ops/images.lock` | 补充 `service-python=python:3.13.7-slim-bookworm`，属于本数据集的合成平台配置，不声称是实际生产平台配置；没有拉取或构建镜像 |
| memory_096_memory-proxy-evaluation | `MemoryProxy/src/native-proxy-tools/tool-registry.ts`、同目录 `types.ts` | Registry 逐字复制当前 Native 源码，只附其需要的独立类型；不连接宿主服务、不实现任务所要求的加载流程 |
| memory_097_memory-proxy-evaluation | `fixtures/bridge-requests.json` | 补齐 `atomic/query`、`scenario/ls`、`scenario/read` 等 Bridge 请求输入，路径与 Baseline Bridge 一致；不附预期工具名称映射或评分答案 |

这3题的工具列表、理由和关联元数据一并复核。镜像配置与 Registry 已能从本地发现，不能补完素材后仍强制要求模型查询 Memory；它们按适用 Skill 的任务保留。原 Memory 事实未改写。

## 会话 ID 如何修正

涉及 memory_042、049、056、063、070。

数据集保留原始会话 ID；准备阶段已生成 `memory-session-map.json`。现在使用此文件，把执行 Query 中完整匹配的源 ID 替换为实际导入 ID，再写入准备目录的 `cases.jsonl`，由两组共同使用。

- 复用冻结 Memory 时，先复制冻结映射，再替换 Query，不使用新推算的 ID。
- 一次替换，避免新 ID 被再次当成旧 ID 替换；不会把 `history-1` 错改到 `history-10` 中。
- 不往 Query 添加理由、标签或目标答案。数据集和审核中的原 ID 保持可追踪。
- 这解决的是评测输入的 ID 对应，不代表已经验证 Bridge 最终读取成功。此前提到的 Bridge 可能覆盖查询 `session_id` 的核心行为不属于本次改动，也没有通过真实请求宣称解决。
- 已停止或完成的旧实验不会被回写。直接绕过准备阶段运行的观测配置，应自行使用与其种子匹配的执行 Query。

## 重复与含糊的处理口径

未发现完全相同的 Query；进一步核对近似任务后，移出 none_081，保留 none_046：两题都是给 README 添加相同的 `npm test`，且项目中的实际测试脚本相同，额外覆盖价值有限。

不同项目的时间范围查询、场景背景整理虽然措辞接近，但来源事实不同，没有仅凭句式相似全部删除。“同题有多种风险”也没有被当成重复题。

对不确定的业务状态、索引需求、SLO 窗口等，没有编造历史决定来补答案；对用户已登录 Chrome、真实发布 Git 起点，没有伪造环境。这些题移出正式集。完整名单见下方。

## 验证与边界

会话替换测试先验证旧代码不能生成正确执行 Query，再实现并通过回归。数据测试检查有效任务与 removed 记录互斥、审核保留完整、工具及资源引用有效。素材 Registry 已独立实例化，验证公开工具数量、Schema 和参数校验；未运行云端业务。

实际验证结果：

后续复验（2026-09-06 19:35 UTC）：并行修改已将 Viewer 测试的不同任务改为独立 Task ID，并修正身份测试的类型问题。`npm run typecheck` 通过；全量45个测试文件、213项测试全部通过。下列失败记录保留清理阶段当时的情况，不代表当前仍未通过。

- 本次相关6个测试文件、29项测试通过，包含数据清理、审核一致性、资源校验、会话 ID、指标和 Query 输入隔离。
- 全量测试执行结果为210通过、2失败。两项失败位于 `viewer.test.ts`；其多任务测试清单复用了 `task_id=task`，与并行修改中新增加的 Task 唯一性校验冲突，不是此次数据数量变更导致。没有替另一项工作修改校验或测试。
- 全仓类型检查未通过，错误位于并行新增的 `tests/evaluation-identity.test.ts`，涉及可能为 undefined 的访问。本次未改该文件，不能宣称全仓检查通过。
- 本次修改范围的 `git diff --check` 通过。没有为避开失败删除测试或关闭校验。

本轮数据 SHA-256：`1c1cc4f795036992481b165f5aa70448b7735173d960572b94c70f2376a2376d`。

未提交、未推送、未运行正式或小规模评测。其余并行工作保持不动。

## 移出清单

| 任务 | 原因 |
| --- | --- |
| none_093_cli-file-processing | 字面 API 检查与相关 Skill 强制加载的边界不清，不宜作为确定负例。 |
| none_037_message-queue-workers | 可变引用审查与缺陷诊断 Skill 的适用边界不清。 |
| skill_074_document-rag | 现有质量评估附件恒定返回通过，不能支持按真实质量调整流程的要求。 |
| memory_020_react-frontend | 目标测试约定已在本地体现，首次 Memory 调用的必要性不明确。 |
| none_075_document-rag | 局部输入校验与缺陷修复流程均合理，负例标签依据不足。 |
| skill_023_postgres-migrations | 未提供新增查询负载，现有索引可能已满足需求。 |
| memory_048_api-auth-security | 组合键限流与切换维度不能绕过要求之间含糊。 |
| memory_050_testing-bugfix | Query 已说明复现和修复流程，不能可靠要求先查询历史。 |
| skill_028_postgres-migrations | 缺少唯一性业务字段组合，需人为发明业务规则才能执行。 |
| memory_013_python-fastapi | 保留现有 detail 与历史响应结构冲突，查询必要性不明确。 |
| memory_022_postgres-migrations | 未指定实际订单状态变更，无法确定迁移内容。 |
| memory_026_postgres-migrations | 现有查询与索引已匹配，任务没有说明真实缺口。 |
| memory_061_cicd-release | Query 已给失败阻断规则，与历史查询的必要性难以区分。 |
| memory_055_testing-bugfix | 当前测试已经体现真实服务及必要边界替身，历史信息缺口不明确。 |
| memory_081_document-rag | 历史规则针对扫描件/PDF，当前 HTML 与该历史需求不匹配。 |
| none_081_observability-performance | 两题均只要求在 README 写 npm test；虽然项目不同，package.json 的测试脚本完全相同，所需信息、修改动作和观测目标重复，保留 none_046。 |
| skill_069_browser-automation | 依赖用户已经登录的真实 Chrome 会话，不能用生成文件替代。 |
| skill_067_browser-automation | 缺少用户已有 Chrome，会话数与历史限制也有冲突。 |
| memory_027_postgres-migrations | 缺少实际正向状态变更，发布 SQL 无确定目标。 |
| memory_086_observability-performance | 所谓已确定 SLO 未提供统计窗口，不能凭空补业务决定。 |
| memory_058_cicd-release | 缺少真实 Git 起点和历史，生成假历史会改变本月发布分支任务的含义。 |
