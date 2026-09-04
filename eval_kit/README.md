# TencentDB Agent Memory Eval Kit

这个目录统一保存评测配置、Skill/Memory 数据、批量导入工具、A/B 运行程序、指标计算和结果页面。`tencentdb-memory-lab` 继续负责运行 Baseline、Native 和数据构建服务，不在这里保存密钥、数据库或日志。

当前主要目录：

```text
eval_kit/
├── configs/                 # 数据准备和实验配置
├── dataset/                 # 任务、输入文件、Skill、L0 和生成参考
├── data-preparation/        # 生成统一底稿并安装到两套环境
├── importers/               # Skill 与 L0 批量导入
├── runner/                  # Baseline/Native 用例运行
├── recorder/                # Langfuse、ClickHouse 和客户端记录
├── metrics/                 # 指标计算
├── viewer/                  # 逐条查看评测结果
├── tests/
└── results/                 # 本地结果，不提交 Git
```

## Commands

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
prepared-skills/
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
  --directory ./prepared-skills \
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

`summary.json` 的 `paired_deltas_native_minus_baseline` 统一采用 Native − Baseline；Token/时延为负表示 Native 更少或更快。Provider Token 来自完整 Langfuse Observation；定义 Token 使用固定 `cl100k_base` 分别估算 Baseline XML 工具块与 Native canonical JSON schema；TTFT 优先采用 Claude stream 结果里的 `ttft_stream_ms`。Trace 未稳定到齐时，Provider 派生指标为 `null`，并保留部分原始采集用于归因。

每个 `CaseRun` 都固化 Dataset 输入/断言、身份、原始请求、逐次注入后的 Model Call、thinking/stop reason、工具调用与结果、最终答案、指标和失败标签。`config.json` 还保存 Harness 逐文件哈希、各仓 Commit/工作区状态、Prompt/Schema 内容哈希、资产快照与固定 Run-order 哈希。
