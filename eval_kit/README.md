# TencentDB Agent Memory Eval Kit

> 当前正式调用统计使用 **Bridge 发起记录（配置版本 2）**：直接读取两组 JSONL，不依赖 Langfuse。
> 操作方式见 [Proxy Tool 观测统计说明](docs/proxy-tool-observation.md)。
> 一键准备并评测：`bash run-pipeline.sh configs/pilot.example.yaml`，详见 [Pipeline 使用说明](docs/pilot-pipeline.md)。
> 小样本入口默认只测 Tool Calling，到指定事件即停止；已有 9 条 × 两组的实际结果、修复和未解决问题见 [试跑报告](docs/pilot-9-task-report.md)。
> 已有独立身份运行表时：`npm run run -- --config configs/bridge-observation.local.yaml`。
> Viewer 提供可筛选的数据集概览和当前 Bridge 实验结果对比：`npm run viewer -- --results results --port 4173`。可用 `--dataset` 指定任务文件，见 [页面使用说明](docs/viewer.md)。
> 下方旧实验中的 `npm run run` 现应使用 `npm run legacy:run`；dataset 与 data-preparation 用法不变。

修订数据的 30 题复查使用 `bash run-pipeline.sh configs/pilot-30.yaml`：Memory、Skill、None 各 10 题，首次调用即停止，按允许的首次工具选择评分。`sample_seed` 固定抽样，`per_family: all` 可运行全部 Main，Probe 仍单列。数据变化与标签边界见 [v2 修订说明](dataset/review/v2-revision.md)。

当前 Pipeline 给每个任务的两组独立 Agent 导入配置 `skills` 目录中的完整 Skill 库，不再按 `candidate_skills` 筛选。默认数据集有15个 Skill；旧字段仍可读取，但不影响导入和评分。`reuse_preparation` 只复用原任务、Memory 和工作区，Skill 始终取当前配置目录，因此从旧6个候选切换为完整库时不需要重新提炼 Memory，也不再属于原 Skill 环境的原样重跑。

已完成 30 题 × 两组的真实运行，逐题调用、指标、修复记录与正式评测前仍需解决的问题见 [30 题实测报告](docs/pilot-30-task-report.md)。

这个目录统一保存评测配置、Skill/Memory 数据、批量导入工具、A/B 运行程序、指标计算和结果页面。`tencentdb-memory-lab` 继续负责运行 Baseline、Native 和数据构建服务，不在这里保存密钥、数据库或日志。

当前主要目录：

```text
eval_kit/
├── configs/                 # 数据准备和实验配置
├── dataset/                 # 任务、输入文件、Skill、L0 和生成参考
├── data-preparation/        # 生成统一底稿并安装到两套环境
├── pipeline/                # 逐 Task 独立身份、顺序提炼、配对同步和一键试跑
├── bridge-eval/             # Bridge 事件采集、观测终止、调用指标汇总
├── importers/               # Skill 与 L0 批量导入
├── runner/                  # Baseline/Native 用例运行
├── recorder/                # Langfuse、ClickHouse 和客户端记录
├── metrics/                 # 指标计算
├── viewer/                  # 数据集分布、任务浏览与评测结果对比
├── tests/
└── results/                 # 本地结果，不提交 Git
```

Memory 缓存默认开启（`memory_cache: true`），底稿保存在 `results_dir/memory-cache/`。同一组 L0 会话内容、顺序、原始时间和提炼配置/源码相同时，只提炼一次；后续任务或实验复制已有 L0～L3，不调用 LLM。每个 Agent 仍得到独立副本，记录和会话编号随新任务改写；不会复制正式运行后新增的 Memory，也不会复用旧任务、标签或 Assets。`builder/task-XX/ready.json` 中的 `cache.status` 为 `hit` 或 `miss`，命中时旧提炼耗时单列为 `source_elapsed_ms`。需要重新提炼时设置 `memory_cache: false`。详情见 [Memory 复用说明](docs/pilot-pipeline.md#memory-自动复用)。

## Commands

以下命令均在 `eval_kit` 目录中执行：

```bash
npm install
npm run run -- --config configs/experiments/smoke.yaml --reset-assets
npm run run -- --config configs/experiments/smoke.yaml --resume
npm run run -- --config configs/experiments/smoke.yaml --case smoke_skill_load --variant native
npm run score -- --experiment results/native-proxy-tool-smoke-v3-20260831
npm run viewer -- --results results --port 4173
```

## 为 A/B 评测准备相同数据

正式对比 Baseline 与 Native 时，不要分别向两边导入 L0 并各自等待记忆生成，因为两次
LLM 调用可能得到不同的 L1/L2/L3。统一入口会在独立环境中只处理一次，再把同一份结果
安装到两边：

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
./prepare-data.sh --check  # 只检查配置和数据
./prepare-data.sh          # 处理一次并安装到两套环境
```

项目路径、Skill 路径、Memory 路径和导入身份统一写在
[`configs/data-preparation.yaml`](configs/data-preparation.yaml)。详细说明见
[`docs/data-preparation.md`](docs/data-preparation.md)。

下面两个独立导入命令仍可用于日常调试；它们不保证两套环境各自生成的 L1/L2/L3 相同。

## 批量导入 Skill

`skills:import` 会递归查找指定目录中的 `SKILL.md`，校验 `name`、
`description` 和正文格式，然后调用现有 `/v3/skill/*` 接口，把 Skill 归到指定
用户、团队和 Agent。每个 `SKILL.md` 同目录下的 `files/` 可放附属文件：

```text
dataset/skills/
├── order-service-conventions/
│   ├── SKILL.md
│   └── files/
│       └── review-checklist.md
└── movie-discussion/
    └── SKILL.md
```

先检查文件及目标端已有的同名 Skill，不写入数据：

```bash
npm run skills:import -- \
  --variant both \
  --directory ./dataset/skills \
  --user-id usr-f7iwo2muhb \
  --team-id team-f7jadamhk3 \
  --agent-id agt-f7jq1rrl7h \
  --service-id rhino-ab \
  --on-conflict error \
  --dry-run
```

确认输出后去掉 `--dry-run` 执行导入。`--variant` 可取 `native`、`baseline`
或 `both`。同名处理方式必须明确选择：

- `error`：默认值，发现同名 Skill 后停止，并且不写入任何 Skill；
- `skip`：保留已有 Skill，只创建缺少的项；
- `update`：使用已有版本号更新 `SKILL.md`，已有附属文件保持不变。

默认从 `../tencentdb-memory-lab/<variant>/secrets/core-gateway.key` 读取 API
凭据，不在命令行或输出中展示。其他部署可以使用 `--lab-root`、
`--native-api-key-file`、`--baseline-api-key-file`，或设置
`TDAI_NATIVE_SKILL_API_KEY` / `TDAI_BASELINE_SKILL_API_KEY`。Native 和 Baseline
默认地址分别为 `http://127.0.0.1:18420` 与 `http://127.0.0.1:8420`。

`both` 会依次写入 Baseline 和 Native，两套服务之间无法提供数据库级事务；若第二套
服务失败，第一套已经完成的写入不会自动撤销。重新执行时可用 `skip` 或 `update` 接续。

## 批量导入 L0 对话

`memories:import` 会递归读取目录中的 `.json` 和 `.jsonl` 文件，将历史对话分批写入
MemoryCore `/v3/conversation/add`。每批最多 100 条消息。接口保存 L0 后会通知项目现有
的记忆处理程序，L1 记忆、L2 场景和 L3 用户画像随后由 MemoryCore 在后台生成。

单个 JSON 文件可以表示一段会话：

```json
{
  "session_id": "imported-order-service",
  "messages": [
    {
      "role": "user",
      "content": "订单服务统一使用 pnpm。",
      "timestamp": "2026-09-01T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "明白，后续相关命令优先使用 pnpm。"
    }
  ]
}
```

也支持顶层数组、`{"sessions": [...]}`，以及每行一段会话的 JSONL。`session_id`
可以省略，脚本会根据文件位置生成可重复得到的导入会话 ID。每段会话必须至少包含一条
`user` 消息，否则 MemoryCore 不会启动后续记忆提取，脚本会直接报错。

先检查文件、身份和目标端是否已有同名会话，不写入数据：

执行前先把正式评测用的 `.json` 或 `.jsonl` 文件放入 `dataset/memories/`；空目录会直接报错，避免误以为已经完成检查。

```bash
npm run memories:import -- \
  --variant both \
  --directory ./dataset/memories \
  --user-id usr-f7iwo2muhb \
  --team-id team-f7jadamhk3 \
  --agent-id agt-f7jq1rrl7h \
  --dry-run
```

确认后去掉 `--dry-run` 正式导入。L0 是原始消息记录，没有覆盖更新语义，因此同一
`session_id` 已有消息时必须选择以下处理方式：

- `error`：默认值，正式写入前停止，避免重复导入；
- `skip`：跳过已有会话，只导入新会话；
- `append`：将文件中的消息继续追加到已有会话。

```bash
npm run memories:import -- \
  --variant both \
  --directory ./dataset/memories \
  --user-id usr-f7iwo2muhb \
  --team-id team-f7jadamhk3 \
  --agent-id agt-f7jq1rrl7h \
  --on-conflict error
```

导入结果中的 `extractionScheduled: true` 表示 L0 已完整接收，并已具备触发后续处理的
用户消息。L1/L2/L3 是异步生成的：当前实验环境中，新会话通常会立即开始 L1，L2 默认
在 L1 完成约 90 秒后处理，L3 在 L2 完成后处理。是否实际产生新内容仍由抽取模型根据
对话内容决定。脚本使用与 Skill 导入相同的服务地址和 `core-gateway.key`，也可通过
`TDAI_NATIVE_MEMORY_API_KEY`、`TDAI_BASELINE_MEMORY_API_KEY` 单独覆盖凭据。

实验目录已默认从 Git 排除。Runner 拒绝覆盖同名实验；`--resume` 只有在原配置文件 SHA-256 与 Dataset SHA-256 均一致时才继续，并跳过已经写完的 Run。`--reset-assets` 与 `--resume` 互斥，前者会调用 Lab 的 `restore-seed`，并在实验快照中保存其保留备份路径。

所有实验目录/文件分别使用 `0700`/`0600`。Authorization、API Key、Cookie 等 Header 在 Tap 落盘前永久脱敏；凭据文件内容只传入 Claude/Langfuse/ClickHouse 客户端内存，不进入结果快照。

## Result contract

```text
results/<experiment_id>/
├── config.json
├── summary.json
├── cases.jsonl
├── runs/<run_id>.json
└── raw/<run_id>/
    ├── client-stream.jsonl
    ├── proxy-tap.jsonl
    ├── langfuse-observations.json
    └── clickhouse-tool-calls.json
```

`summary.json` 的 `paired_deltas_native_minus_baseline` 统一采用 Native − Baseline；Token/时延为负表示 Native 更少或更快。Provider Token 来自完整 Langfuse Observation；TTFT 优先采用 Claude stream 结果里的 `ttft_stream_ms`。Trace 未稳定到齐时，Provider 派生指标为 `null`，并保留部分原始采集用于归因。

## 指标口径

- 有效调用率：发生任意参评 Proxy Tool 调用的正样本数 / 全部正样本数。选错类别仍计为调用，再由工具选择正确率判错。
- 误调用率：发生 Proxy Tool 调用的负样本数 / 全部负样本数。同一负样本同时调用 Memory 和 Skill，总体只算一次。
- 工具选择正确率：选择正确的正样本数 / 已发生调用的正样本数。`by_tool_family.memory` 和 `by_tool_family.skill` 按任务预期类别分正样本，两类误调用率共用全部负样本。结果保留分子、分母；空分母为 `null`，不伪装成 0%。
- 同一 `call_id` 的重复采集只算一次；新 ID 调用同名工具仍是新的调用。工具选择按模型生成顺序检查，不按结果完成顺序。
- 单步可用 `allowed_first_tools: ["skill_search", "skill_view"]` 表示任选其一；多步可用 `expected_tool_sequence: ["skill_search", "skill_view"]`，或 `allowed_sequences: [["skill_view"], ["skill_search", "skill_view"]]`。多步要求完整顺序匹配，不能先错后对，也不会将重复调用去掉再评分。三种规则最多声明一种。旧的单个 `expected_tool` / `expected_tools` 检查首次调用；旧的多工具 `expected_tools` 保持无序必需集合语义，有顺序要求时请显式补充标注。工具执行错误和参数断言单独记录，不改变“是否发生调用”的结果。
- `tool_micro_precision/recall` 是旧的工具名称集合诊断项，与上面的案例级指标分开，不作为实验报告中的有效调用率。
- `suites` 分别列出 `main`、`probe`、`smoke`、`reliability` 中实际存在的组。正式数据含 `probe` 时，请从 `suites.main.variants` 取主实验指标，避免与探查案例混合；最外层 `overall` 仍表示本次文件中的全部运行。

### 静态 Token

`variants.<variant>.static_definition` 是正式静态指标：Baseline 统计固定 Fake Tool 说明、调用规则及 curl 示例；Native 统计 Proxy Schema **加 System 固定调用引导**。提取器移除 Memory 正文、Skill/Knowledge 目录条目，并统一运行时身份 Header 的占位值。只读取真实请求中实际出现的说明，未注入的内容不会补造。

统一用 `cl100k_base` 编码普通文本，各固定 System 块分别求和，Native 再加完整的 canonical JSON Schema 数组；忽略顶层 `cache_control`，保留 Schema 内同名的业务属性。该值是统一统计规则下的相对成本，不是服务商精确计费 Token。

同一份固定内容在汇总时只编码一次。`configurations` 保留每种配置的 `source_run_id`、`system_tokens`、`schema_tokens` 和 `total_tokens`，方便回看对应 Langfuse 原始输入。如果固定内容确有多种，`tokens` 为 `null` 并分别列出，不能按 Query 加权平均。`static_token_comparison.reduction_percent` 使用 `(Baseline − Native) / Baseline × 100`，只有两组各有一种可确认的固定配置且 Baseline 大于零时才计算。旧 `definition_tokens` 分布仅为逐次运行诊断，Viewer 使用新的静态指标。

采样优先取初始化后已提供工具的请求。统计始终以实际内容为准：Native 标签下出现 Fake Tool 文案仍会计入，并记录 `native_contains_fake_tool_guidance`；缺少 Proxy Schema 或 Baseline 出现 Proxy Schema 也会提示。存在这些配置问题时，不输出 Token 降幅，避免把漏注入或组别错误当成优化收益。历史输入缺失记为 `null`。

### 端到端延迟

从 Runner 提交输入并启动 Claude 到收到最终 `result` 计时，不在首次 Tool Call 停止，也不把结果采集、Claude 进程收尾计入。旧记录没有最终事件到达时间时保留原记录的延迟，不假造更精确的历史值。超时、运行异常、Trace 不完整的记录单独保留，排除出正常性能与调用率分母。

同一实验、同一 Case、同一 Variant 的重复运行先取均值，再跨 Case 统计均值、中位数、P95。偶数样本的中位数取中间两项平均，P95 使用 nearest-rank。`end_to_end_comparison` 仅比较两组都有有效记录的相同案例，给出两组均值、配对案例数和 `(Native − Baseline) / Baseline × 100`。不会用最后一次运行覆盖此前重复结果。延迟仍须结合调用正确率解读，漏调用后的快速回答不能说明性能改善。

评分依赖已采集的工具记录：目前采集端主要读取 Claude/Anthropic 消息；Baseline 识别直接写出 URL 的 curl 请求，变量拼接 URL、复杂脚本或单个 Bash 中的多次 HTTP 调用尚不能完整展开。ClickHouse 没有可匹配调用 ID 时，工具耗时/错误保持未知，不按同名工具或行号猜测。正式运行前应先抽查这类记录；本文的指标修复不代表整个评测 Runner 已完成所有客户端和协议的验收。

每个 `CaseRun` 都固化 Dataset 输入/断言、身份、原始请求、逐次注入后的 Model Call、thinking/stop reason、工具调用与结果、最终答案、指标和失败标签。`config.json` 还保存 Harness 逐文件哈希、各仓 Commit/工作区状态、Prompt/Schema 内容哈希、资产快照与固定 Run-order 哈希。
