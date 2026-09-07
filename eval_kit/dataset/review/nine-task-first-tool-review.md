# 9题首次工具入口修订

2026-09-06，经用户确认后写回正式数据。仅修改9题的 `allowed_first_tools`、对应 `expected_tools` 和 `reason`；Query、素材、类别、正负例和评分公式不变。正式数据仍为279题：Memory 42、Skill 162、None 75。

## 裁定原则与列表

评价合理的首次入口，不要求它是最短路径或一次取得完整答案。工具名称、具体参数、最终完成情况分开判断；两组采用同一标签。

| 任务 | 允许的首次工具 |
| --- | --- |
| memory_076、082、088、094、100 | tdai_read_scene、tdai_scenario_ls、tdai_memory_search、tdai_conversation_search |
| memory_023 | tdai_memory_search、tdai_conversation_search、tdai_read_scene、tdai_scenario_ls、skill_view、skill_search |
| memory_030 | tdai_memory_search、tdai_conversation_search、tdai_read_scene、tdai_scenario_ls |
| memory_014、021 | tdai_conversation_search、tdai_memory_search、tdai_read_scene |

- 场景整理题允许先核对目录，但目录与搜索命中不等于完整场景正文。
- 主键题既需要项目历史决定，又涉及数据库迁移方法，因此保留合理的 Skill 入口。
- 缓存题允许先找相关场景，不因使用 Redis 就要求并发、锁或限流 Skill。
- 两道时间题要求的是历史事件发生时间；`atomic_query` 实际过滤 L1 的 `updated_time`。本轮冻结 L1 于9月生成，不能用4月的事件时间直接筛选，故移除该标准首调，允许先查原文、相关决定或场景再核对时间与出处。

## 证据与边界

核对实验：`pilot-2026-09-06T19-47-50-494Z`。Langfuse 首次输入与 Claude 原始输出、Bridge 日志、Native Ledger 共同用于审查；Langfuse 中部分输出为空，不能仅靠它证明完整工具执行。

逐题审核 JSONL 新增 `first_tool_review`，保存修订前的最终裁定和依据路径。原 `independent_review`、`input_validation` 保持不变；当前有效裁定是 `final`，与正式任务文件一致。

两项不能被新标签掩盖的事实：

- memory_100：Native 将英文项目名作为 `path_prefix`，与已注入的中文路径不匹配。工具名称命中不代表这个参数正确。
- memory_021：Native 第一轮还生成了时间查询和原文搜索，但旧统计在首次目录调用后截止。此次没有把截止后的调用补入评分，没有把指标改成“任意一次命中”。

原始 `summary.json`、第一次重算的 `summary-relabeled.json` 及各 `runs/*.json` 均保留。当前重算另存到实验目录的 `summary-first-tool-review.json` 和 `runs-first-tool-review.json`；未重新运行模型。Viewer 历史实验结果未被覆盖，不能把旧展示误认为本次重算。

## 按既有记录重新计分

| 工具选择正确率 | Baseline | Native |
| --- | ---: | ---: |
| 本次9题 | 7/9（77.78%） | 8/9（88.89%） |
| 62题中的37道 Memory | 35/37（94.59%） | 36/37（97.30%） |
| 62题中的24道 Skill | 10/24（41.67%） | 7/24（29.17%） |
| 62题中的61道正例总体 | 45/61（73.77%） | 43/61（70.49%） |

两组有效调用率仍为61/61；唯一负例均发生 Memory 调用，误调用率仍为1/1，不具备代表性。静态注入为Baseline 4073、Native 2778 Token，下降31.79%，沿用原测量。没有完成端到端回答的运行，因此没有有效端到端延迟。

## 验证

- 只修改9题标签及理由，其他270题保持不变，全部 Query 和素材不变。
- 原盲审和注入证据保持不变，修订前裁定已保留。
- `npm run typecheck` 通过；47个测试文件、224项测试通过。
- 当前正式任务文件 SHA-256：`06b29477f65db3c1e5e6dbd87b1c7736bfa32a9c617e0a9507e48b813fc364bf`。
