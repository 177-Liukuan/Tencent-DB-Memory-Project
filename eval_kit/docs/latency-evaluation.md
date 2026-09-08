# 独立端到端延迟评测

复用现有 Pipeline，将 `measurement` 设为 `end_to_end`。不在首次工具调用后停止，也不将该实验加入工具调用主指标。默认从 Main 中随机抽取纯 Memory 2 题、纯 Skill 2 题、None 1 题，每题每组运行 5 次，共 50 次正式运行；混合类别不参与这次分层抽样。

## 运行

按实际部署修改 `configs/latency.example.yaml` 中的项目、数据、服务路径和模型，随后执行：

```bash
bash /home/liukuan/Tencent-DB-Memory-Project/eval_kit/run-pipeline.sh /home/liukuan/Tencent-DB-Memory-Project/eval_kit/configs/latency.example.yaml
```

配置内相对路径以 YAML 所在目录为准。沿用现有部署的密钥文件与 Bridge 观测目录；不另配采集服务。示例不会自动重启服务，以免打断其他会话。`allow_bash: true` 的权限跳过仅用于当前任务的隔离容器，请使用可信素材。

每个重复使用独立 Agent、Task、Session 和工作区副本。每题的 Memory 只准备一次，其余重复与两组均复制同一离线种子；`memory_cache: true` 可复用现有干净底稿，不复制已经做过任务的 Agent。Skill 导入完整库。CLI 关闭思考模式。延迟模式暂不接受旧的 `reuse_preparation` 整轮清单，避免它与随机抽样、替补的编号对应关系混用。

配对串行运行，随机决定每对谁先执行。抽样种子、初选任务与同类别备选顺序保存在准备目录 `latency-plan.json`。一次正常结束并输出最终响应即可纳入，不以代码正确、工具选对为条件；拒绝、澄清或说明无法继续同样计时。

## 超时与替补

单次上限 600 秒。任一重复超时、异常退出或观测失效时，两组整道任务排除，已发生的运行与耗时保留；尚未启动的重复明确记为 `not_started`。按预先保存的顺序准备同类别替补，重新执行该题两组全部重复。默认最多替换 5 次；用尽、无同类备选或准备失败时保留结果并报告未收齐，不无限重试。

因此正式结果只代表筛选后能正常返回的任务，不能据此推断超时率或所有任务的延迟。排除原因和轨迹会另行展示。

## 计算与展示

计时从正式 Query 的 CLI 执行启动到完整 `result` 事件接收完成，包含 CLI／隔离容器启动、模型生成、实际工具执行、重试及模型重入；不包含数据导入、镜像准备与 Agent 创建。原始数据单位为毫秒，网页均值与标准差显示秒，方差显示秒²。

- 每题分别统计两组重复运行的均值、样本方差（除以次数减一）和标准差。
- 整体使用所有完整纳入任务的运行数据重新计算，不平均各题方差。默认全部收齐时每组 25 次。
- 延迟变化率 = `(Native 均值 − Baseline 均值) / Baseline 均值 × 100%`；负数表示 Native 更快。
- 同题两组必须次数完整、Query 与初始资产版本一致；未收齐标为待完成，异常整题排除。不按任务标签或工具选择得分筛选。

结果保存到 `results/latency-*/`。Viewer 的实验选择器选择“延迟”实验，即可查看总体指标、逐任务统计、排除原因与可展开的工具轨迹。原工具调用实验继续显示“本轮未测量”，不会拿其他实验的延迟拼入原指标。

`summary.json` 的 `latency_study` 为统计数据；`report.md` 为独立汇总。`runs/*.json` 保存最终响应、耗时、异常信息；`raw/<run_id>/client-stream.jsonl` 保存对话事件，`bridge-events.json` 保存实际到达 Bridge 的工具顺序。CLI `client_turns` 不等于上游模型请求总数。轨迹用于辅助解释波动，不能单凭调用次数认定耗时原因。

修改展示或统计后，可对已有延迟结果执行 `npm run score -- --experiment results/<实验编号>` 重新汇总，不重新调用模型。
