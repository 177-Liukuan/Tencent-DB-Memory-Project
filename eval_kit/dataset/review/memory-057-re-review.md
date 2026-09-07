# memory_057 单题复审

2026-09-07。复用已有 Langfuse 输入快照、任务源码、来源对话和 Skill 正文；未重新调用模型。本次不是独立盲审，也不是按两组得分挑选标签。

## 裁定：Memory／Skill 双入口

Query 保持不变：

> 请为现有发布自动化拟一条提交信息，概括制品校验和回滚计划这两部分功能，格式遵循仓库的发布提交规范。

`should_call=true`，主要需求元数据 `tool_family=memory` 保留。允许的首次工具为：

| 工具 | 本题的具体依据 |
|---|---|
| `tdai_memory_search` | L3 只给出提交格式，没有 release scope 的适用条件；检索 L1 可以确认仓库约定。 |
| `tdai_conversation_search` | 来源对话首轮明确写出 release scope 仅用于发布自动化；可以直接检索原始规定。 |
| `tdai_read_scene` | 两组实际 L2 目录均提供“CI-CD发布与部署工程约定.md”，摘要明确包含提交规范。 |
| `tdai_scenario_ls` | 先核对目录再定位上述场景也是合理入口，虽比直接读取冗余，但不属于无关调用。 |
| `skill_view` | 实际 Skill 描述包含 release documentation，正文也覆盖制品溯源与回滚；提交说明与之至少部分相关，两组提示词均要求加载部分相关 Skill。 |
| `skill_search` | 可以先查找发布文档、制品和回滚相关 Skill；已有目录时直接查看更省一步，但发现入口也合理。 |

`expected_tools` 与该列表一致；`reason` 为每个工具提供独立理由。`expected_skills` 为 `safe-release-pipeline`，不强制读取与本题无关的迁移门禁或渐进发布附件。

## 为什么修正之前的判断

之前判断“safe-release-pipeline 没有提交 scope 规则，所以先调用 Skill 不合理”，把两个问题混为一谈：

- Skill 能否独自回答仓库特有的提交规范？**不能**，正文没有这条约定。
- 先查看相关 Skill 是否符合本题及实际提示词？**可以**。它的对外描述明确包括发布文档，不应只看正文的部署工作流而忽略模型实际看到的适用范围。

本题不要求修改或执行发布流水线，不能为此额外要求模型做部署、测试、回滚操作；但按当前“部分相关也加载”的规则，先查看相关说明仍合理。此判断不适用于任意同名项目：如果 Skill 描述没有发布文档范围，或加载规则改变，应重新审核。

当前允许列表原来有 `skill_view`，却漏了有实际路径依据的 `tdai_read_scene`，理由也没解释 Skill。此次不是简单退回旧列表，而是补回场景读取、补齐同用途的 Skill 搜索入口，并修正旧审核结论。

Baseline 的场景读取、Native 的 Skill 查看均可判为合理首调。**这里只判断入口，不证明模型已补齐 scope、参数正确或最终回答合格。** 查完 Skill 后仍可能需要 Memory；本题不强制第一步就是最短路径。

## 核对的证据

- `dataset/assets/memory_057_cicd-release/scripts/promote.mjs`：`validateArtifact()` 与 `rollbackPlan()` 是现有功能，无需虚构未提供的 diff。
- 工作区 README、发布文档没有提交格式或 scope 限定。
- `dataset/memories/cicd-release-40-rounds.json` 首轮：`type(scope): imperative-summary`，release scope 仅用于发布自动化本身。
- `dataset/skills/safe-release-pipeline/SKILL.md` 的 description、Core Workflow 及两个参考文件。
- 已有实际输入：`results/pilot-2026-09-06T23-26-11-070Z/input-review/task-14-baseline.json`、`task-14-native.json`。两组 L3 均仅给出提交格式，L2 提供上述场景，Skill 目录均包含 release documentation。
- 两组 `MemoryProxy/src/injection/injectors/skill-injector.ts`：相关或部分相关时加载 Skill 的共同规则。

## 修改范围

仅更新这道题的标签与逐工具理由，并同步 `ai-pre-review.jsonl`、`pilot-45-label-review.jsonl` 的最新裁定。新增 `single_task_review` 保留修改前标签和结论，原独立预审、旧输入快照及旧裁定备份不改。

未修改 Query、资产、工具实现、提示词和评分公式；未改写 `results/` 下的运行记录或汇总，未重跑评测。因此历史结果页仍按上次保存的运行标签评分，不代表本次复审标签已用于重新计算。

验证：`npm test` 全部 236 项通过，原4项一致性失败消除；`npm run typecheck`、`git diff --check` 均通过。未提交或推送。
