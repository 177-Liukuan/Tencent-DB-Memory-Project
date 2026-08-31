# Native Proxy Tool Eval

独立的 Dataset → Baseline/Native 双栈运行 → Trace 归并 → 离线指标 → Case Viewer 评测包。首期 `smoke` 仅用于校准链路，不代表正式 A/B 结论。

## Commands

```bash
npm install
npm run run -- --config configs/smoke.yaml --reset-assets
npm run run -- --config configs/smoke.yaml --resume
npm run run -- --config configs/smoke.yaml --case smoke_skill_load --variant native
npm run score -- --experiment results/native-proxy-tool-smoke-v3-20260831
npm run viewer -- --results results --port 4173
```

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
