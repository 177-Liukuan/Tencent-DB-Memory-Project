# Proxy Tool 观测统计：使用与边界

## 现在使用哪个入口

正式调用统计使用 `npm run run -- --config configs/bridge-observation.local.yaml`（配置版本 2）。
旧入口改为 `npm run legacy:run`，只用于旧实验；不要把它的 Langfuse/CLI 拼接记录与本方案混合计分。
数据集内容没有修改。新 Pipeline 负责逐 Task 数据准备，旧 data-preparation 整体复制流程仍保留。Viewer 只读取当前 Bridge 观测结果，不兼容旧实验格式。
页面用 `manifest.json` 和 `runs/*.json` 读取结果；也可直接阅读 `summary.json`。操作说明见 [结果查看器](viewer.md)。

## 两组观察的是同一个位置

Baseline：Claude Code → Bash/curl → Bridge → 真实业务。
Native：MemoryProxy → 内部 Bridge 调用 → 真实业务。

Bridge 在处理后端查询前写入一行事件。Memory 多来源查询不重复记录；Native 的内部重试保留相同 call_id，Runner 去重。
普通 Bash/Read、工具文本描述、系统初始化、后台 Memory 写入均不计入。

这里统计的是**到达 Memory/Skill Bridge 的请求**。未到达 Bridge 的命令失败、Native 参数校验失败不在统计范围内。
后端空结果、业务错误或超时不会删除已记录的发起事件。不使用 Mock，不等待 Langfuse，不依赖 ClickHouse 工具日志。

## 运行前的准备

1. 在两组 Proxy YAML 中配置：
   ```yaml
   evalToolObservation:
     enabled: true
     directory: /absolute/path/to/variant/tool-observations
   ```
   重启 Proxy；默认关闭，不影响非评测部署。Docker 需把目录挂载给评测程序。
2. 为每个 Case × 方案 × 重复次数准备独立 Team、Agent、Task；Session 由 Runner 创建。
   Skill 有团队可见搜索，所以这里也检查 Team 不被其他 Task 共用。
3. 从相同初始数据准备配对资产与工作区，填写运行表。参考 ../configs/bridge-runs.example.json。
   `seed_version` 是数据准备方对初始资产的声明，不是 Runner 对后端内容一致性的自动证明。
**旧 data-preparation 提供公共资产版本；新的一键 Pipeline 会创建逐 Task 独立身份，并实际核对两组数据，见 [一键运行](pilot-pipeline.md)。**
   数据准备在 Pipeline 中完成，Runner 只消费核对后的运行表，不负责修改或提炼业务数据。
4. 参考 ../configs/bridge-observation.example.yaml 填写两个地址、记录目录、密钥文件路径和模型名称。

每个 Agent 只使用一次：Runner 在观测目录的 .used-agents 中独占登记；失败运行也不能自动重用。
实验目录存在时直接拒绝覆盖。第一版没有自动 Resume；重跑使用新实验编号、新身份和重新准备的资产。

## 命令

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit

# 查看入口说明
npm run run -- --help

# 运行映射表中的所有 Task；按表顺序执行，可交替安排两组先后次序
npm run run -- --config configs/bridge-observation.local.yaml

# 已完成实验重新计算汇总，不会再次调用模型
npm run score -- --experiment results/<experiment_id>

# 只读查看结果，不启动新评测；默认仅监听服务器本机
npm run viewer -- --results results --port 4173
```

无需手动安装评测 Claude Hooks。Runner 为每次运行创建独立 Claude 配置：
Native 自动配置 UserPromptSubmit、PreCompact、PostCompact；Baseline 使用独立空 Hook 配置。
两组都禁用项目设置来源，显式指定同一个模型；不使用会禁用 Hooks 的 --bare。
允许的客户端工具为 Bash、Read、Write、Edit、Glob、Grep；Bash 自动授权限于 curl。
需要运行测试命令等其他 Bash 操作的完整 Coding 评测，必须先统一审定两组工具授权范围，不能把受权限限制的未完成任务当成快速完成。

## 输出

```text
results/<experiment_id>/
├── config.json
├── manifest.json
├── summary.json
├── runs/<run_id>.json
└── raw/<run_id>/
    ├── bridge-events.json
    ├── client-stream.jsonl
    ├── client-stderr.log
    ├── claude-config/settings.json
    └── workspace/
```

settings.json 含本次调用所需密钥；所有运行数据均在 Git 忽略的 results 下，目录 700、关键文件 600，不要公开上传。
Bridge 日志只记录 event_id、session_id、工具名、类别、时间、Native call_id，不保存参数和结果。

## 怎么计算

- 每次 Task 运行只算一个样本，调用多次不会提高有效调用率。
- 正样本是否调用任意 Memory/Skill 决定有效调用；具体工具是否正确另外计分。
- Memory/Skill 正样本分开统计；两类误调用率均使用无须 Proxy Tool 的负样本作分母。
- 单步使用允许的第一个工具；串行多步使用预设顺序。Bridge 到达顺序不等于并行情况下的模型生成顺序；并行案例应使用 expected_tools 集合，不应声明严格顺序。
- Main、Smoke、Probe、Reliability 分组，主指标不混入探针。
- 调用比例的分母是有效 Task 执行样本（包含独立的重复执行），不是 Tool Call 条数；保持各 Case 重复次数一致。
- 端到端时间从启动 CLI 提交问题，到成功 final result 到达；不含资产准备、设置文件生成、统计和进程收尾。含 CLI 启动与正常会话初始化。
- 延迟先对同一 Case 多次执行取均值，再汇总均值、中位数和 P95；配对差值只使用两组都完成的配对运行。
- 参数正确率、工具结果成功率和答案质量本入口不评分。静态工具注入 Token 继续用现有 token 模块单独统计一次，不能用新结果中的空模型记录计为零 Token。

## 采集失败怎么处理

采用同步追加，无异步发送队列。文件不存在只有在 Proxy 观测正常、未重启、CLI 正常完成时才解释为零调用。
Runner 前后检查 /health 的 toolObservation，并核对目录内 observer.json。写入失败在健康状态中保持失败，需排障并重启后再测试；不改变 Bridge 业务响应。
出现采集故障、文件损坏、Proxy 重启或 CLI 超时/异常，该次运行标记无效、CLI 返回非零退出码，不当作“未调用”计入主比例。
已经留下的发起记录仍保存供诊断。第一版按单 Proxy 进程、同主机或共享挂载目录运行，不做多实例采集服务。

## 本机部署提示

本机两组配置已经开启，目录分别为：
- /storage1/liukuan/tencentdb-memory-lab/baseline/run/tool-observations
- /storage1/liukuan/tencentdb-memory-lab/native/run/tool-observations

本机 Baseline 的 preflight 原本拒绝任何 tracked 源码差异。为运行本次埋点补丁，systemd drop-in 通过
TDAI_BASELINE_OBSERVATION_PATCH_SHA256 允许部署时确认的精确 tracked diff，HEAD 检查和端口隔离检查保留。
后续修改 Baseline tracked 文件或提交该补丁后，需要重新审查/更新这个部署例外，不能把它当作关闭保护。
