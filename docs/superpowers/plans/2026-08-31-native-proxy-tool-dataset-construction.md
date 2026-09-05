# Native Proxy Tool 数据集构建实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建 6 个相互隔离的数据库工程场景包；每包完成一次 Memory/Skill 生成、审核与冻结，并产出 10 条正向 Recall Case，形成 Baseline 与 Native 共用的 `recall-v1.0.0` 数据版本。

**Architecture:** 每个场景先用一段受控生成会话产生多个 Memory 与 Skill，再由人工审核形成只读 fixture 快照。召回任务只引用已冻结的资产；Baseline 与 Native 使用字节级相同的 Case、fixture、身份和权限运行。60 条正向 Recall Case 之外，另建 12 条困难负例用于误调用率，不与正向召回成功率混算。

**Tech Stack:** JSONL、JSON/YAML manifest、SHA-256、现有 TypeScript `eval_kit/` Harness、Zod、Vitest、Memory Bridge、Skill Bridge、Langfuse。

**Spec:** `Native Tool课题目标与技术实施方案（内部）.md` 第 4.6 节，以及 2026-08-31 已确认的“6 个场景包—生成—冻结—每包 10 条召回任务”设计。

## Global Constraints

- 正式集必须恰好包含 6 个场景包；每包恰好包含 10 条审核通过的正向 Recall Case，共 60 条。
- 每个场景包使用独立的逻辑空间、测试身份、工作目录、资产命名空间和 fixture 快照，不跨包复用 Memory、Skill 或事实。
- 每包生成并冻结 12 条目标 Memory、3 条诱饵 Memory 和 3 个 Skill；诱饵只改变一个维度：版本、项目、租户或方案状态。
- 每包 10 条正向 Case 固定为 4 条 Memory-only、4 条 Skill-only、2 条 Memory+Skill。
- 另建每包 2 条困难负例，共 12 条；负例不占每包 10 条召回任务的名额，并独立统计误调用率。
- 主 A/B 只覆盖 Memory 与 Skill。Knowledge、工程可靠性故障注入和 Provider Tool 不进入本数据版本。
- 生成阶段允许触发 Skill 提取；Recall 阶段必须使用只读测试身份，并关闭 `skill_extract` 及所有 Skill 写工具。
- Baseline 与 Native 只能读取同一个冻结 release；不得分别生成、修订或复制出内容不同的资产。
- 正式 Case 不出现 `TDAI`、`Native Tool`、`Fake Tool`、具体工具注册名或 curl 路径；两臂看到的用户问题必须完全相同。
- 每条正向 Case 必须有唯一、可判定的工具集合和目标资产证据。若存在两条同样合理的调用路径，重写 Case，不把歧义带入 `v1.0.0`。
- 当前 `eval_kit/runner/dataset-loader.ts` 使用严格 Schema；`cases.jsonl` 与 `negative-controls.jsonl` 继续使用现有 `EvalCase` 字段，场景、fixture、证据和审核信息放入 sidecar 文件。
- 数据只使用合成内容或获得授权且不可逆脱敏的内容；任何 API Key、真实用户身份、生产 Trace、凭据或受限业务数据都不得进入仓库。

---

## 1. 完成定义

数据集构建完成需要同时满足：

1. 6 个场景均有生成脚本、生成元数据、资产审核记录、fixture manifest、证据索引和内容哈希。
2. 每个场景均冻结 12 条目标 Memory、3 条单维度诱饵 Memory 和 3 个可读取 Skill。
3. `cases.jsonl` 恰好 60 条、Case ID 全局唯一、每包恰好 10 条。
4. 60 条 Case 的组成恰好为 24 条 Memory-only、24 条 Skill-only、12 条 Memory+Skill。
5. `negative-controls.jsonl` 恰好 12 条，每包 2 条。
6. 每条正例都能通过 `scenario-index.json` 追溯到目标资产、证据和审核决议。
7. Baseline 与 Native 使用相同 release ID、数据集 SHA-256、fixture hash、身份和权限通过 ready-check。
8. 正式 release 创建后不原地改写；任何修改发布新版本。

## 2. 数据流

```text
场景合同
  ↓
受控生成会话
  ↓
Memory / Skill 候选资产
  ↓
资产审核 + 诱饵补齐 + 检索探针
  ↓
只读 fixture 快照
  ↓
每场景 15 条正向候选题 + 4 条负向候选题
  ↓
双人审核，选出 10 条正例 + 2 条负例
  ↓
recall-v1.0.0 冻结
  ↓
Baseline / Native 成对评测
```

生成质量与 Recall 能力分开记录：

- 生成质量回答“是否形成了正确、边界清晰、可复用、可检索的资产”。
- Recall 质量回答“同一批冻结资产下，模型是否在正确时机调用正确 Memory/Skill”。
- Native/Fake 主 A/B 只比较 Recall 阶段；生成产物不随评测臂变化。

## 3. 六个场景包

| ID | 场景主题 | 12 条目标 Memory 覆盖 | 3 个 Skill |
| --- | --- | --- | --- |
| `s01-schema-migration` | Schema 演进与兼容迁移 | 字段废弃决策、expand/contract 窗口、兼容矩阵、灰度条件、验证结论、回滚阈值和历史例外 | `s01_schema_migration_review`、`s01_migration_validation`、`s01_migration_rollback` |
| `s02-query-performance` | 慢查询与索引优化 | 接口 P95、EXPLAIN 结论、索引取舍、写放大预算、压测条件、已拒绝方案和线上例外 | `s02_query_plan_diagnosis`、`s02_index_design_review`、`s02_sql_benchmark` |
| `s03-transaction-locking` | 事务并发与锁冲突排障 | 死锁时间线、事务边界、隔离级别、重试策略、热点行方案、恢复验证和已知误判 | `s03_lock_wait_diagnosis`、`s03_deadlock_triage`、`s03_transaction_retry_review` |
| `s04-backup-recovery` | 备份、恢复与灾难演练 | RPO/RTO、保留策略、恢复顺序、演练记录、加密约束、验收项和特批窗口 | `s04_backup_integrity_check`、`s04_point_in_time_restore`、`s04_disaster_recovery_drill` |
| `s05-replication-cdc` | CDC、复制与多地域一致性 | 延迟阈值、位点决策、冲突原则、切换记录、校验结果、降级条件和租户例外 | `s05_replication_lag_triage`、`s05_cdc_consistency_validate`、`s05_failover_readiness_check` |
| `s06-tenant-governance` | 多租户权限、审计与数据治理 | Tenant scope、最小权限、脱敏字段、审计保留期、授权例外、事故复盘和合规验收 | `s06_rbac_access_review`、`s06_tenant_isolation_check`、`s06_audit_evidence_collect` |

### 3.1 每包统一 Memory 配方

- 4 条历史决策或项目约束；
- 3 条实验、事故或演练结果；
- 2 条当前配置、数值阈值或版本信息；
- 2 条例外、边界条件或已批准豁免；
- 1 条最终验收结论；
- 3 条诱饵：一条过期版本、一条错误项目或租户、一条已拒绝方案。

每条 Memory 必须有一个仓库内逻辑引用：

```text
mem:<scenario_id>:<concept>:v<version>
```

逻辑引用映射到后端实际资产 ID，但不直接出现在用户 Query 中。

### 3.2 每包统一 Skill 配方

- 一个主流程 Skill：归当前测试 Agent 所有并出现在 `available_skills`，可直接 `skill_view`；
- 一个诊断或校验 Skill：归同 Team 的另一个测试 Agent 所有，不出现在当前 Agent 自有目录，但可由 `skill_search` 发现；
- 一个回滚、恢复或边界处理 Skill：包含完成任务所必需的资源文件，必须经过 `skill_view` 后调用 `skill_files_read`。

每个 Skill 必须包含稳定名称、版本、所有者、可见范围、适用条件、输入要求、执行步骤、产物格式和必要资源文件；资源文件路径必须进入 fixture manifest。三种所有权/资源配置用于让 `skill_view`、`skill_search` 与 `skill_files_read` 的预期路径保持唯一，Baseline 与 Native 的目录可见性必须一致。

## 4. 每场景 10 条 Recall Case 的固定槽位

| 槽位 | 类型 | 设计要求 |
| --- | --- | --- |
| `r01` | Memory-only | 直接询问历史决定，但不出现工具名；目标为项目专属事实。 |
| `r02` | Memory-only | 隐式询问当前应该遵守的约定；问题本身不提供答案。 |
| `r03` | Memory-only | 新旧版本并存，只允许召回当前有效结论。 |
| `r04` | Memory-only | 相关 Skill 同时存在，但问题只需要历史事实，禁止额外调用 Skill。 |
| `r05` | Skill-only | 直接要求按团队既有流程完成检查或生成产物。 |
| `r06` | Skill-only | 隐式能力选择，不出现 Skill 名称或“SOP”字样。 |
| `r07` | Skill-only | 完成任务必须读取 Skill 资源文件，预期包含 `skill_files_read`。 |
| `r08` | Skill-only | 相关 Memory 同时存在，但问题只需要通用流程，禁止额外调用 Memory。 |
| `r09` | Memory+Skill | 先取得项目专属阈值或约束，再按对应 Skill 执行。 |
| `r10` | Memory+Skill | 先取得历史例外，再选择回滚、恢复或边界处理 Skill。 |

总体组成：

| 类型 | 每包 | 总数 |
| --- | ---: | ---: |
| Memory-only | 4 | 24 |
| Skill-only | 4 | 24 |
| Memory+Skill | 2 | 12 |
| 合计 | 10 | 60 |

### 4.1 独立负样本库

每个场景另外创建：

- `n01`：词面诱导负例。问题含“历史、记忆、流程、规范”等词，但答案属于通用知识或已完整写在题面中。
- `n02`：Claude Code 原生工具任务或当前上下文充分的任务；允许客户端工具，但禁止所有 Proxy Memory/Skill Tool。

12 条负例只用于 `false_call_rate`，不进入 60 条 Recall 正例的成功率。

## 5. 文件布局

```text
eval_kit/
├── fixtures/
│   └── scenarios/
│       ├── s01-schema-migration/
│       │   ├── scenario.md
│       │   ├── generation-contract.yaml
│       │   ├── generation-metadata.json
│       │   ├── fixture-manifest.json
│       │   └── evidence-index.json
│       ├── s02-query-performance/
│       ├── s03-transaction-locking/
│       ├── s04-backup-recovery/
│       ├── s05-replication-cdc/
│       └── s06-tenant-governance/
├── datasets/
│   ├── README.md
│   ├── schemas/
│   │   ├── generation-contract.schema.json
│   │   ├── fixture-manifest.schema.json
│   │   ├── candidate-index.schema.json
│   │   ├── review-decision.schema.json
│   │   ├── scenario-index.schema.json
│   │   └── release-manifest.schema.json
│   ├── drafts/
│   │   └── recall-v1.0.0/
│   │       ├── s01-candidates.jsonl
│   │       ├── s01-candidate-index.json
│   │       ├── s01-reviews.jsonl
│   │       ├── s02-candidates.jsonl
│   │       ├── s02-candidate-index.json
│   │       ├── s02-reviews.jsonl
│   │       ├── s03-candidates.jsonl
│   │       ├── s03-candidate-index.json
│   │       ├── s03-reviews.jsonl
│   │       ├── s04-candidates.jsonl
│   │       ├── s04-candidate-index.json
│   │       ├── s04-reviews.jsonl
│   │       ├── s05-candidates.jsonl
│   │       ├── s05-candidate-index.json
│   │       ├── s05-reviews.jsonl
│   │       ├── s06-candidates.jsonl
│   │       ├── s06-candidate-index.json
│   │       └── s06-reviews.jsonl
│   └── frozen/
│       └── recall-v1.0.0/
│           ├── cases.jsonl
│           ├── negative-controls.jsonl
│           ├── scenario-index.json
│           ├── release-manifest.json
│           └── SHA256SUMS
└── reliability/                  # 独立工程可靠性集，不由本计划创建
```

## 6. 数据契约

### 6.1 正向 Case

冻结后的 `cases.jsonl` 继续兼容现有 `EvalCase`：

```json
{"schema_version":1,"case_id":"recall-v1-s02-r03","suite":"main","query":"这个接口当前允许的索引写放大预算是多少？请按现行结论回答。","should_call":true,"expected_tools":["tdai_memory_search"],"argument_assertions":[{"tool":"tdai_memory_search","path":"query","operator":"regex","value":"索引|写放大|预算"}],"answer_assertions":[{"operator":"contains","value":"1.8"}],"tool_family":"memory","difficulty":"hard","tags":["scenario:s02-query-performance","stratum:memory_only","challenge:freshness"]}
```

Memory+Skill Case 使用 `expected_tools` 的精确集合；例如：

```json
{"schema_version":1,"case_id":"recall-v1-s04-r09","suite":"main","query":"按照我们批准的 RPO 目标，对这份恢复演练结果做完整性检查。","should_call":true,"expected_tools":["tdai_memory_search","skill_search","skill_view"],"answer_assertions":[{"operator":"contains","value":"RPO"}],"difficulty":"hard","tags":["scenario:s04-backup-recovery","stratum:memory_skill","order:memory_then_skill"]}
```

现有评分器按工具集合精确匹配，因此 `v1.0.0` 不接收“任选其一”的多路径 Case。

### 6.2 负向 Case

```json
{"schema_version":1,"case_id":"recall-v1-s04-n01","suite":"main","query":"题面已经说明每天备份一次并保留 7 天，请计算一周会保留多少个每日备份。","should_call":false,"expected_tools":[],"tool_family":"none","difficulty":"hard","tags":["scenario:s04-backup-recovery","stratum:negative","reason:context_sufficient"]}
```

### 6.3 `scenario-index.json`

每个 Case 的 sidecar 条目必须包含：

```json
{
  "case_id": "recall-v1-s02-r03",
  "scenario_id": "s02-query-performance",
  "slot": "r03",
  "fixture_ref": "fixture:s02-query-performance:v1.0.0",
  "expected_asset_refs": ["mem:s02-query-performance:index-write-budget:v2"],
  "forbidden_tools": ["skill_search", "skill_view", "skill_files_read"],
  "evidence_refs": ["evidence:s02:index-write-budget-current"],
  "review_status": "approved",
  "reviewers": ["annotator-a", "annotator-b"],
  "adjudication": "两名审核者均确认答案只存在于当前版本 Memory。"
}
```

`annotator-a` 与 `annotator-b` 是固定的评测角色标识；真实姓名只记录在内部交付清单，不写入公开数据。

### 6.4 `fixture-manifest.json`

每个场景 manifest 至少包含：

- `scenario_id`、`fixture_version` 和 `fixture_hash`；
- 逻辑空间、测试身份和只读权限摘要；
- 12 条目标 Memory、3 条诱饵 Memory、3 个 Skill 的逻辑引用、实际 ID、版本和内容哈希；
- Skill 资源文件路径和哈希；
- setup receipt、reset 方法和 ready-check 探针；
- 生成模型、生成 Prompt 版本、生成时间和脱敏审核结果。

## 7. 资产审核标准

### 7.1 Memory 门禁

每条目标 Memory 必须同时满足：

- 与生成会话事实一致；
- 单条表达一个主要事实、决定或约束；
- Scope、项目、时间和版本明确；
- 与其他目标 Memory 不重复；
- 使用当前测试身份可检索；
- 关键答案不是通用常识；
- 不包含凭据、真实身份或生产数据。

### 7.2 Skill 门禁

每个 Skill 必须同时满足：

- 触发条件明确，能与另外两个 Skill 区分；
- 步骤完整且可由测试环境执行或静态验证；
- 输入、输出和失败边界明确；
- 引用的资源文件确实存在且哈希固定；
- 不把场景专属历史事实完整写入 Skill；
- 不包含环境凭据或不可公开内部地址。

### 7.3 生成阶段评分

生成阶段单独记录以下诊断结果，但不进入 Baseline/Native 主 A/B：

- Memory 合格数、重复数、事实错误数、Scope 错误数；
- Skill 合格数、边界重叠数、资源缺失数；
- 生成候选到冻结资产的通过率；
- 需要人工改写的原因分布。

## 8. Recall Case 审核标准

每条候选必须由两名审核者独立判断：

1. 题面不直接泄漏答案或资产名称；
2. 不调用目标工具就无法稳定得到答案或完成任务；
3. 目标工具集合唯一，额外工具调用应判错；
4. 目标资产可通过固定测试身份读取；
5. `answer_assertions` 能覆盖至少一个 fixture 独有事实；
6. Query 不使用 Baseline 或 Native 专属措辞；
7. 与同包其他 Case 的核心问题不同；
8. Memory-only、Skill-only 与 Memory+Skill 的责任边界清楚。

审核结果只能是：

- `approved`：原样进入候选池；
- `rewrite`：记录原因并产生新 Case ID；
- `rejected`：保留记录但不进入冻结集。

审核后不得静默修改原 Case。

## 9. 执行任务

### Task 1: 固化数据契约与目录

**Files:**
- Create: `eval_kit/dataset/README.md`
- Create: `eval_kit/dataset/schemas/generation-contract.schema.json`
- Create: `eval_kit/dataset/schemas/fixture-manifest.schema.json`
- Create: `eval_kit/dataset/schemas/candidate-index.schema.json`
- Create: `eval_kit/dataset/schemas/review-decision.schema.json`
- Create: `eval_kit/dataset/schemas/scenario-index.schema.json`
- Create: `eval_kit/dataset/schemas/release-manifest.schema.json`

**Interfaces:**
- Consumes: 现有 `eval_kit/types.ts`、`eval_kit/runner/dataset-loader.ts` 和本计划第 5–8 节。
- Produces: 六个场景共同使用的字段、命名、审核和冻结契约。

- [ ] **Step 1: 写明主集、负例集和 sidecar 的职责边界**

  `README.md` 必须明确：`cases.jsonl` 供现有 Harness 加载；场景、fixture 和证据由 `scenario-index.json` 关联；任何 sidecar 字段不得临时塞进严格 Case Schema。

- [ ] **Step 2: 固定 ID 与版本规则**

  使用：

  ```text
  Case:    recall-v1-<scenario-short-id>-r01..r10
  Negative: recall-v1-<scenario-short-id>-n01..n02
  Memory:  mem:<scenario_id>:<concept>:vN
  Skill:   skill:<scenario_id>:<capability>:vN
  Fixture: fixture:<scenario_id>:v1.0.0
  Release: recall-v1.0.0
  ```

- [ ] **Step 3: 定义六个 sidecar Schema**

  Schema 必须拒绝未知字段、重复资产逻辑引用、非 64 位十六进制 SHA-256、非本场景前缀的资产引用以及非 `approved/rewrite/rejected` 的审核状态。

- [ ] **Step 4: 人工复核 Schema 与现有 Loader 的兼容性**

  确认正式 Case 只使用 `EvalCase` 已支持字段；联合工具 Case 使用 `expected_tools` 精确集合，场景信息通过 `tags` 和 sidecar 保存。

- [ ] **Step 5: Commit**

  ```bash
  git add eval_kit/dataset/README.md eval_kit/dataset/schemas
  git commit -m "docs(eval): define recall dataset contracts"
  ```

### Task 2: 编写 S01 Schema 迁移场景合同

**Files:**
- Create: `eval_kit/fixtures/scenarios/s01-schema-migration/scenario.md`
- Create: `eval_kit/fixtures/scenarios/s01-schema-migration/generation-contract.yaml`

**Interfaces:**
- Consumes: Task 1 的生成合同 Schema。
- Produces: S01 的 12 条目标 Memory、3 条诱饵 Memory、3 个 Skill 的生成事实合同。

- [ ] **Step 1:** 写入 expand/contract、兼容窗口、灰度校验和回滚阈值组成的多轮生成故事。
- [ ] **Step 2:** 将 12 条目标事实按 4/3/2/2/1 配方逐条编号，并写明唯一证据句。
- [ ] **Step 3:** 写入过期字段方案、错误项目兼容矩阵和已拒绝停机迁移三个单维度诱饵。
- [ ] **Step 4:** 定义 `s01_schema_migration_review`、`s01_migration_validation`、`s01_migration_rollback` 的触发条件和产物。
- [ ] **Step 5:** 由第二名审核者确认没有事实同时被 Memory 和 Skill 完整承载。
- [ ] **Step 6: Commit**

  ```bash
  git add eval_kit/fixtures/scenarios/s01-schema-migration
  git commit -m "test(eval): define schema migration scenario"
  ```

### Task 3: 编写 S02 慢查询场景合同

**Files:**
- Create: `eval_kit/fixtures/scenarios/s02-query-performance/scenario.md`
- Create: `eval_kit/fixtures/scenarios/s02-query-performance/generation-contract.yaml`

**Interfaces:**
- Consumes: Task 1 的生成合同 Schema。
- Produces: S02 的性能阈值、索引取舍和压测流程合同。

- [ ] **Step 1:** 写入接口 P95、EXPLAIN、候选索引、写放大预算和压测结论组成的多轮生成故事。
- [ ] **Step 2:** 将 12 条目标事实按统一配方逐条编号并附证据句。
- [ ] **Step 3:** 写入旧 P95、其他服务索引方案和已拒绝宽索引三个诱饵。
- [ ] **Step 4:** 定义诊断、索引评审和基准测试三个 Skill 的边界。
- [ ] **Step 5:** 审核所有数值均为合成值，且答案无法由常识猜出。
- [ ] **Step 6: Commit**

  ```bash
  git add eval_kit/fixtures/scenarios/s02-query-performance
  git commit -m "test(eval): define query performance scenario"
  ```

### Task 4: 编写 S03 事务锁场景合同

**Files:**
- Create: `eval_kit/fixtures/scenarios/s03-transaction-locking/scenario.md`
- Create: `eval_kit/fixtures/scenarios/s03-transaction-locking/generation-contract.yaml`

**Interfaces:**
- Consumes: Task 1 的生成合同 Schema。
- Produces: S03 的死锁事件、事务约定和排障流程合同。

- [ ] **Step 1:** 写入一次死锁事故、事务边界、隔离级别、重试和热点行治理故事。
- [ ] **Step 2:** 将 12 条目标事实逐条编号并附唯一证据。
- [ ] **Step 3:** 写入过期重试次数、其他租户热点表和已否决全局锁方案三个诱饵。
- [ ] **Step 4:** 定义锁等待诊断、死锁分诊和事务重试评审三个 Skill。
- [ ] **Step 5:** 审核排障事实与执行流程没有互相替代。
- [ ] **Step 6: Commit**

  ```bash
  git add eval_kit/fixtures/scenarios/s03-transaction-locking
  git commit -m "test(eval): define transaction locking scenario"
  ```

### Task 5: 编写 S04 备份恢复场景合同

**Files:**
- Create: `eval_kit/fixtures/scenarios/s04-backup-recovery/scenario.md`
- Create: `eval_kit/fixtures/scenarios/s04-backup-recovery/generation-contract.yaml`

**Interfaces:**
- Consumes: Task 1 的生成合同 Schema。
- Produces: S04 的 RPO/RTO、演练结果和恢复流程合同。

- [ ] **Step 1:** 写入备份策略、恢复演练、加密约束、RPO/RTO 和验收故事。
- [ ] **Step 2:** 将 12 条目标事实逐条编号并附唯一证据。
- [ ] **Step 3:** 写入旧 RPO、其他项目保留期和已否决恢复顺序三个诱饵。
- [ ] **Step 4:** 定义备份完整性、时间点恢复和灾备演练三个 Skill。
- [ ] **Step 5:** 审核 Skill 不包含本场景最终 RPO/RTO 数值。
- [ ] **Step 6: Commit**

  ```bash
  git add eval_kit/fixtures/scenarios/s04-backup-recovery
  git commit -m "test(eval): define backup recovery scenario"
  ```

### Task 6: 编写 S05 复制 CDC 场景合同

**Files:**
- Create: `eval_kit/fixtures/scenarios/s05-replication-cdc/scenario.md`
- Create: `eval_kit/fixtures/scenarios/s05-replication-cdc/generation-contract.yaml`

**Interfaces:**
- Consumes: Task 1 的生成合同 Schema。
- Produces: S05 的复制阈值、故障切换和一致性校验合同。

- [ ] **Step 1:** 写入 CDC 位点、复制延迟、冲突处理、切换记录和降级条件故事。
- [ ] **Step 2:** 将 12 条目标事实逐条编号并附唯一证据。
- [ ] **Step 3:** 写入旧延迟阈值、其他地域位点和已拒绝自动切主方案三个诱饵。
- [ ] **Step 4:** 定义复制延迟分诊、CDC 一致性验证和切换就绪检查三个 Skill。
- [ ] **Step 5:** 审核所有租户、地域和位点均为合成标识。
- [ ] **Step 6: Commit**

  ```bash
  git add eval_kit/fixtures/scenarios/s05-replication-cdc
  git commit -m "test(eval): define replication cdc scenario"
  ```

### Task 7: 编写 S06 多租户治理场景合同

**Files:**
- Create: `eval_kit/fixtures/scenarios/s06-tenant-governance/scenario.md`
- Create: `eval_kit/fixtures/scenarios/s06-tenant-governance/generation-contract.yaml`

**Interfaces:**
- Consumes: Task 1 的生成合同 Schema。
- Produces: S06 的权限、脱敏、审计和合规流程合同。

- [ ] **Step 1:** 写入 Tenant scope、角色映射、脱敏字段、审计保留和授权例外故事。
- [ ] **Step 2:** 将 12 条目标事实逐条编号并附唯一证据。
- [ ] **Step 3:** 写入过期角色、其他租户授权和已拒绝共享账号方案三个诱饵。
- [ ] **Step 4:** 定义 RBAC 评审、租户隔离检查和审计证据收集三个 Skill。
- [ ] **Step 5:** 完成人工敏感信息扫描，确认没有真实账号、密钥或组织信息。
- [ ] **Step 6: Commit**

  ```bash
  git add eval_kit/fixtures/scenarios/s06-tenant-governance
  git commit -m "test(eval): define tenant governance scenario"
  ```

### Task 8: 运行六次生成并审核资产

**Files:**
- Create: `eval_kit/fixtures/scenarios/s01-schema-migration/generation-metadata.json`
- Create: `eval_kit/fixtures/scenarios/s01-schema-migration/fixture-manifest.json`
- Create: `eval_kit/fixtures/scenarios/s01-schema-migration/evidence-index.json`
- Create: `eval_kit/fixtures/scenarios/s02-query-performance/generation-metadata.json`
- Create: `eval_kit/fixtures/scenarios/s02-query-performance/fixture-manifest.json`
- Create: `eval_kit/fixtures/scenarios/s02-query-performance/evidence-index.json`
- Create: `eval_kit/fixtures/scenarios/s03-transaction-locking/generation-metadata.json`
- Create: `eval_kit/fixtures/scenarios/s03-transaction-locking/fixture-manifest.json`
- Create: `eval_kit/fixtures/scenarios/s03-transaction-locking/evidence-index.json`
- Create: `eval_kit/fixtures/scenarios/s04-backup-recovery/generation-metadata.json`
- Create: `eval_kit/fixtures/scenarios/s04-backup-recovery/fixture-manifest.json`
- Create: `eval_kit/fixtures/scenarios/s04-backup-recovery/evidence-index.json`
- Create: `eval_kit/fixtures/scenarios/s05-replication-cdc/generation-metadata.json`
- Create: `eval_kit/fixtures/scenarios/s05-replication-cdc/fixture-manifest.json`
- Create: `eval_kit/fixtures/scenarios/s05-replication-cdc/evidence-index.json`
- Create: `eval_kit/fixtures/scenarios/s06-tenant-governance/generation-metadata.json`
- Create: `eval_kit/fixtures/scenarios/s06-tenant-governance/fixture-manifest.json`
- Create: `eval_kit/fixtures/scenarios/s06-tenant-governance/evidence-index.json`

**Interfaces:**
- Consumes: Tasks 2–7 的场景合同和当前产品的 Memory/Skill 生成能力。
- Produces: 六个可供 Baseline/Native 共用的只读 fixture。

- [ ] **Step 1: 为六个场景创建隔离身份和命名空间**

  每个场景记录独立 `space/team/agent` 测试标识；同一标识同时授权给 Baseline 与 Native，只开放读取冻结资产所需权限。

- [ ] **Step 2: 按场景合同执行六段独立生成会话**

  每段会话只包含当前场景事实。生成元数据记录模型 ID、参数、Prompt/合同 hash、Session ID、开始结束时间和生成 trace 引用。

- [ ] **Step 3: 收集所有实际生成资产，不挑选性丢弃失败候选**

  `generation-metadata.json` 保存目标数、实际数、重复数、失败数和所有候选逻辑引用。

- [ ] **Step 4: 按第 7 节执行 Memory 与 Skill 双人审核**

  只有通过审核的 12 条目标 Memory 和 3 个 Skill 进入 fixture；若不足，回到同一场景合同补充生成并保留补充记录。

- [ ] **Step 5: 添加三条单维度诱饵并验证 Scope**

  诱饵使用独立项目、版本或租户字段。目标评测身份不得把错误 Scope 资产当作当前正确答案。

- [ ] **Step 6: 执行 direct Bridge ready-check**

  不经模型，验证资产数量、实际 ID、版本、内容 hash、Skill manifest 和权限；任一不匹配即阻断冻结。

- [ ] **Step 7: 写入 fixture manifest 和 evidence index**

  `evidence-index.json` 只供评分与人工审核，不注入模型上下文。

- [ ] **Step 8: Commit**

  ```bash
  git add eval_kit/fixtures/scenarios
  git commit -m "test(eval): add frozen memory and skill scenario fixtures"
  ```

### Task 9: 为每个场景编写 Recall 候选

**Files:**
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s01-candidates.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s02-candidates.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s03-candidates.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s04-candidates.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s05-candidates.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s06-candidates.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s01-candidate-index.json`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s02-candidate-index.json`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s03-candidate-index.json`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s04-candidate-index.json`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s05-candidate-index.json`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s06-candidate-index.json`

**Interfaces:**
- Consumes: Task 8 的 fixture 和 evidence index。
- Produces: 每包恰好 15 条正向候选和 4 条负向候选。

- [ ] **Step 1:** 按第 4 节十个槽位，为每个槽位写一条主正向候选。
- [ ] **Step 2:** 为 `r03`、`r04`、`r08`、`r09`、`r10` 各写一个备选问法，使每包正向候选总数恰好为 15。
- [ ] **Step 3:** 为每包写 4 条负向候选：2 条词面诱导、1 条当前上下文充分、1 条 Claude Code 原生工具任务。
- [ ] **Step 4:** 为每条候选填写现有 Case 字段，并在对应 `sXX-candidate-index.json` 中记录目标资产、禁止工具和证据引用。
- [ ] **Step 5:** 执行答案泄漏扫描，移除资产逻辑引用、Skill 精确名称、工具名和生成合同原句。

### Task 10: 双人审核并选出正式 Case

**Files:**
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s01-reviews.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s02-reviews.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s03-reviews.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s04-reviews.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s05-reviews.jsonl`
- Create: `eval_kit/dataset/drafts/recall-v1.0.0/s06-reviews.jsonl`

**Interfaces:**
- Consumes: Task 9 的候选题。
- Produces: 每包 10 条 approved 正例和 2 条 approved 负例。

- [ ] **Step 1:** 审核者 A、B 分别标注工具必要性、预期工具集合、目标证据和题面歧义。
- [ ] **Step 2:** 统计四个维度的一致性；任何分歧都由第三次裁决或重写解决，不以多数猜测冻结。
- [ ] **Step 3:** 每包按 `r01`–`r10` 各选择一条 approved 正例。
- [ ] **Step 4:** 每包选择 `n01`、`n02` 各一条 approved 负例。
- [ ] **Step 5:** 对全部 72 条题执行 reference run，确认 fixture 可用、目标资产能命中、断言可通过。
- [ ] **Step 6:** 将 reference run 失败区分为题目错误、fixture 错误、检索错误和 Harness 错误；只修复根因，不放宽标签掩盖失败。

### Task 11: 生成并冻结 `recall-v1.0.0`

**Files:**
- Create: `eval_kit/dataset/frozen/recall-v1.0.0/cases.jsonl`
- Create: `eval_kit/dataset/frozen/recall-v1.0.0/negative-controls.jsonl`
- Create: `eval_kit/dataset/frozen/recall-v1.0.0/scenario-index.json`
- Create: `eval_kit/dataset/frozen/recall-v1.0.0/release-manifest.json`
- Create: `eval_kit/dataset/frozen/recall-v1.0.0/SHA256SUMS`

**Interfaces:**
- Consumes: Task 10 的 approved Case 和 Task 8 的 fixture manifests。
- Produces: Baseline 与 Native 唯一允许使用的冻结数据 release。

- [ ] **Step 1:** 按场景 ID、槽位排序合并 60 条正例，保持 JSONL 每行一个 Case。
- [ ] **Step 2:** 合并 12 条负例，确保 `should_call=false` 且不声明预期工具。
- [ ] **Step 3:** 生成 `scenario-index.json`，覆盖全部 72 个 Case ID，不多不少。
- [ ] **Step 4:** 用现有 Loader 加载两个 JSONL 文件。

  Run:

  ```bash
  cd eval_kit
  npx tsx -e "import { loadDataset } from './runner/dataset-loader.ts'; const main=await loadDataset('./dataset/frozen/recall-v1.0.0/cases.jsonl'); const neg=await loadDataset('./dataset/frozen/recall-v1.0.0/negative-controls.jsonl'); console.log(main.cases.length, neg.cases.length, main.sha256, neg.sha256)"
  ```

  Expected: 输出 `60 12`，随后为两个不同的 64 位 SHA-256。

- [ ] **Step 5:** 验证组成。

  Expected:

  ```text
  6 scenarios
  10 positive cases per scenario
  4 memory_only + 4 skill_only + 2 memory_skill per scenario
  2 negative controls per scenario
  72 unique case IDs
  ```

- [ ] **Step 6:** 对 Case、sidecar、六个 fixture manifest、审核记录和 Schema 生成 `SHA256SUMS`。
- [ ] **Step 7:** 在 `release-manifest.json` 记录 release ID、所有 hash、工具定义版本、审核者角色、冻结时间和禁止原地修改声明。
- [ ] **Step 8: Commit**

  ```bash
  git add eval_kit/dataset eval_kit/fixtures/scenarios
  git commit -m "test(eval): freeze recall dataset v1.0.0"
  ```

### Task 12: Baseline/Native 共享性 Pilot

**Files:**
- Create: `eval_kit/dataset/frozen/recall-v1.0.0/pilot-receipt.json`

**Interfaces:**
- Consumes: Task 11 的 release。
- Produces: 两臂共享同一数据和资产的可验证凭据。

- [ ] **Step 1:** 分别从 Baseline 与 Native 执行相同 ready-check，记录 release ID、fixture hash、身份权限摘要和工具目录 hash。
- [ ] **Step 2:** 从每个场景选 `r01`、`r05`、`r09` 各一条，共 18 条，分别跑一次 fresh Session。
- [ ] **Step 3:** Pilot 只校验链路、记录和评分器，不根据结果修改工具描述或正式标签。
- [ ] **Step 4:** 任一失败先归类为 dataset、fixture、environment、harness 或 model/tool behavior；只有前四类允许在发布新版本后重跑。
- [ ] **Step 5:** 写入 `pilot-receipt.json`，证明两臂使用相同 dataset SHA-256 和 fixture hashes。
- [ ] **Step 6:** 运行现有 Harness 测试。

  Run:

  ```bash
  cd eval_kit
  npm test
  npm run typecheck
  ```

  Expected: 全部测试通过，TypeScript 无错误。

## 10. 正式运行建议

数据冻结后的正式 A/B 不属于数据构建本身，但交付时必须附带以下运行约束：

- 每个 Case、每个方案至少运行 4 次 fresh Session；预算允许时运行 6 次。
- 6 次时，每个 Case 使用 3 个 `Baseline → Native` block 和 3 个 `Native → Baseline` block。
- 同一 pair 的两臂尽量相邻运行，固定并发度、模型 snapshot、参数、缓存策略和超时。
- 运行观测单位为 `(scenario_id, case_id, arm, repetition)`；重复运行不是新增 Case。
- 总体分数按 60 个 Case 等权，同时必须报告 6 个场景各自差值。
- 60 条正例用于 Recall 成功率；12 条负例独立用于误调用率。
- 12 条负例只能提供首轮探索性误调用信号；若需要严格限定较小的 FPR 退化，后续应扩充独立负样本 release。
- 只有 6 个独立场景，因此结论应表述为“在冻结的六场景基准上未见关键退化”，不外推为所有未来 Memory/Skill 场景。

## 11. 排期

| 工作日 | 工作内容 | 交付物 |
| --- | --- | --- |
| Day 1 | Task 1；固化契约、目录、命名与审核规则 | Schema、README |
| Day 2–3 | Tasks 2–7；完成六个生成场景合同 | 6 份 scenario 与 generation contract |
| Day 4–5 | Task 8；运行生成、审核资产、补齐诱饵 | 6 份 fixture manifest 与 evidence index |
| Day 6–7 | Task 9；每包构造正负候选题 | 6 份 candidates JSONL |
| Day 8 | Task 10；双人审核、裁决与 reference run | 6 份 review decisions |
| Day 9 | Task 11；冻结 `recall-v1.0.0` | 60 正例、12 负例、manifest、checksums |
| Day 10 | Task 12；两臂共享性 Pilot | pilot receipt 与问题清单 |

若时间压缩，优先减少每条 Case 的运行重复次数，不减少场景数、每包 10 条正式 Recall Case、双人审核或 fixture 冻结步骤。

## 12. 风险与处理

| 风险 | 识别信号 | 处理 |
| --- | --- | --- |
| 生成资产数量不足 | 某包少于 12 条合格 Memory 或 3 个 Skill | 沿同一场景合同补充生成；保留全部失败和补充记录 |
| Memory 与 Skill 职责重叠 | 同一问题可用任一资产完整回答 | 改写资产或 Case；主集不接受 `may_call` |
| 词面泄漏 | Query 包含 Skill 名、资产标题或生成原句 | 改写为语义等价但词面不同的问题 |
| 跨场景污染 | Ready-check 能搜索到其他包资产 | 阻断运行，重建 namespace 与权限 |
| 诱饵成为第二正确答案 | 两位审核者对现行结论不一致 | 删除或改写诱饵，只保留单维度差异 |
| Baseline/Native 资产漂移 | 两臂 fixture hash 或工具目录 hash 不同 | 整个实验 block 无效；不得只补跑一臂 |
| 多条合理工具路径 | Reference run 出现不同但合理的工具集合 | 重写题目，使 `v1.0.0` 保持精确可判 |
| 60 条正例掩盖误调用 | 正例分数高但普通问题乱调用 | 使用独立 12 条困难负例报告 FPR |
| 同场景 Case 相关 | 单一场景明显主导总体变化 | 同时报告场景级结果，不把 60 条视为 60 个独立世界 |

## 13. 最终验收清单

- [ ] 六个场景合同通过审核，主题和事实无跨包复用。
- [ ] 每包冻结 12 条目标 Memory、3 条诱饵 Memory、3 个 Skill。
- [ ] 每个 fixture 均可独立 setup、reset、ready-check。
- [ ] `cases.jsonl` 恰好 60 条，组成是 24 Memory-only、24 Skill-only、12 Memory+Skill。
- [ ] `negative-controls.jsonl` 恰好 12 条。
- [ ] 每条正例都有唯一预期工具集合、目标资产和证据断言。
- [ ] 每条负例均确认当前上下文或原生能力已足够。
- [ ] 两名审核者完成独立标注，所有分歧均有裁决记录。
- [ ] 所有正式 Query 不含工具名、curl、资产 ID 或两臂专属措辞。
- [ ] JSONL 可被现有 Loader 加载，所有 Case ID 唯一。
- [ ] `scenario-index.json` 与 72 个 Case 一一对应。
- [ ] release manifest 与 SHA256SUMS 覆盖数据、fixture、Schema 和审核记录。
- [ ] Baseline 与 Native 的 pilot receipt 证明使用相同 release 和 fixture hashes。
- [ ] 工程可靠性集、Knowledge 和写工具评测未混入本数据版本。
