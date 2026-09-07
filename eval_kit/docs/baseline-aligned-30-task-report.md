# 原 30 题复测：Baseline 语义最小适配版

## 1. 结果

本轮完成了 30 个任务 × 两组，共 60 次运行。其中 59 次观测有效，1 次 Native 超时。没有重跑或覆盖失败记录。

本轮 Native 的 Memory 首次选择更准确，None 误调用也更少，但 Skill 选择明显退步。不能据此认定当前 Native 整体优于 Baseline。

| 指标 | Baseline | Native |
|---|---:|---:|
| 有效运行数 | 30/30 | 29/30 |
| 正样本有效调用率 | 100%（20/20） | 94.74%（18/19） |
| Memory 有效调用率 | 100%（10/10） | 100%（10/10） |
| Skill 有效调用率 | 100%（10/10） | 88.89%（8/9） |
| Memory 工具选择正确率 | 60%（6/10） | 100%（10/10） |
| Skill 工具选择正确率 | 70%（7/10） | 0%（0/8） |
| 总体工具选择正确率 | 65%（13/20） | 55.56%（10/18） |
| None 误调用率 | 40%（4/10） | 10%（1/10） |
| 固定注入 Token | 4,073 | 2,778 |

分母沿用当前评分规则：无效运行先排除；有效调用率统计正样本是否产生任意 Memory/Skill 调用；工具选择正确率只统计其中已经产生调用的样本。因此，Native 的 Skill 分项是 9 个有效样本、8 个发生调用、0 个首次选择正确，不能写成“0/10”。

Baseline 的四次 None 误调用全部是 Skill；Native 的一次是 Memory。固定注入 Token 使用原有 `cl100k_base`，包含固定 System 工具引导和 Native Schema，排除动态 Memory、Skill 条目、Query 和 Tool Result。Native 减少 **31.79%**，不等于整次请求计费 Token 减少同样比例。

来源：[summary.json](../results/pilot-2026-09-06T15-27-17-103Z/summary.json)、[固定 Token 检查](../results/pilot-2026-09-06T15-27-17-103Z/static-token-check.json)。

## 2. 本次运行条件

- 实验：`pilot-2026-09-06T15-27-17-103Z`。
- Baseline：`de3f1cc`；Native：`2d7441b`。启动前均为干净工作区，结束后的 HEAD 和 diff 核对一致。本轮没有修改 Fake/Native 工具核心逻辑、提示词、标签或评分函数。
- 复用 `pilot-2026-09-05T18-38-31-734Z` 冻结的原 30 题，Memory、Skill、None 各 10 题。任务文件逐字一致，30 份初始种子版本全部一致，没有重新提炼 Memory。
- 每个 Task × 版本新建账号、Team、Agent、Session。共 60 个独立账号、Agent 和 Session；按配置将 `usr-f7iwo2muhb` 加入新 Team，供查看资产。
- 两组 Memory/Skill/Workspace 配对核对全部通过。每次运行使用独立可写副本；没有修改冻结资产。复制 Memory 时只重编号内部主键并同步引用，两组使用同一映射。
- 两组使用相同隔离镜像、Claude Code **2.1.263**、模型 `deepseek-v4-flash[1m]`、BM25（embedding 为 none）、180 秒总上限及交替运行顺序。
- CLI 配置仍为 `MAX_THINKING_TOKENS=0`、`alwaysThinkingEnabled=false`。Native 首次上游请求中未显式声明 `thinking`，因此不能宣称已经证明 DeepSeek 服务端关闭了思考；Baseline 保存的消息数组本身也不足以证明请求顶层设置。
- 真实 Bridge 观测，不 Mock 结果。在首次 Proxy Tool 到达 Bridge 后停止；没有调用时等正常回答或达到时限。顺序是 Bridge 到达顺序，不是对模型所有 Tool Call 生成顺序的还原。

实际任务运行时间：2026-09-06 **15:31:47—16:01:37 UTC**，约 29.84 分钟，不含前面的数据准备。43 次达到工具观测点后停止，16 次正常返回最终回答，1 次超时。该模式不测量完整 Coding 端到端延迟，也未验收代码完成质量。

[数据配对](../results/pilot-2026-09-06T15-27-17-103Z/data-preparation.json)、[运行核对](../results/pilot-2026-09-06T15-27-17-103Z/pipeline-audit.json)确认 60 次初始化成功、无身份串用、客户端未发现 Native Tool Call 或调用 ID 泄漏。后者只证明客户端隐藏检查通过，不等于所有任务成功。

## 3. 如何理解这次差异

### Memory 和 None 改善，Skill 明显偏向 Memory

Native 的 10 条 Memory 正例都先调用了 `tdai_memory_search`。此前关注的订单响应包装、场景目录误选等任务，本轮均按标签通过。

但 Native 的 10 条 Skill 正例中：

- 8 条先调用 `tdai_memory_search`，其中 Redis 题还在停止前观测到一次 `tdai_conversation_search`；
- `skill_003_node-typescript-api` 正常返回回答，但没有 Proxy Tool 调用；
- `skill_036_message-queue-workers` 超时，观测无效。

这不是“Skill Schema 没有注入”造成的。对 10 条 Native Skill 任务逐一检查首次上游请求，四个 Skill 工具均存在，相关或部分相关时必须加载的 Skill 引导也存在；两组目标 Skill 均在实际候选目录中，30 对候选顺序一致。旧 `<native_tool_usage>` 没有残留。

证据：[Skill 输入检查](../results/pilot-2026-09-06T15-27-17-103Z/skill-input-check.json)、[全部首次输入审核](../results/pilot-2026-09-06T15-27-17-103Z/input-review/index.json)。

能确认的是：在本轮首次 Bridge 调用这一观察范围内，Native 明显偏向先查 Memory。不能仅凭这一轮，把原因锁定为某一句描述，也不能断言模型得到 Memory 结果后不会继续读 Skill，因为观测已经停止。

同样，None 误调用减少不能抵消 Skill 正例的退步。两者应分别报告，而不是挑选表现更好的一个指标来说明改造有效。

## 4. 唯一无效运行

任务：`skill_036_message-queue-workers`，运行：`task-15-native`。

- Session：`69cf3cb2-5c4e-46c8-8d2f-faa9ceb881ff`。
- 初始化成功，运行期间执行了本地 Bash/Read，没有到达 Bridge 的 Proxy Tool 调用。
- 15:41:10.123 UTC 开始，15:44:10.323 UTC 达到统一 180 秒上限，记录 `Claude timed out`。
- 最后一次上游模型调用在 Langfuse 中从 15:41:35.230 持续到 15:44:56.550，约 201.32 秒。也就是说，任务在等待这次响应期间先达到总时限。
- 该记录的 observation ID 为 `5817790ec6ba4ec8`，trace ID 为 `dbc57e5f5f17e24378d8e79de5ba7f46`。它晚于 CLI 终止才结束，不能将这部分迟到输出计入本轮工具观察。

本次没有证据把它归因于此前的 409、Ledger 或 Hook 问题，也没有修改核心逻辑。超过客户端截止时间后，上游调用记录仍继续了一段时间；取消传播及可能产生的额外耗时/成本，作为后续单独检查项。

[运行记录](../results/pilot-2026-09-06T15-27-17-103Z/runs/task-15-native.json)、[原始 CLI 事件](../results/pilot-2026-09-06T15-27-17-103Z/raw/task-15-native/client-stream.jsonl)。

全部运行结束并写出报告后，Pipeline 因存在无效样本返回退出码 1。这是预期的完整性提示，不是准备失败或结果丢失。无效样本被保留并排除出正常指标，没有修改统计方式。

## 5. 查看与复现

Viewer 已重启，结果列表、概览及超时任务详情接口均返回 HTTP 200；概览显示 planned=60、recorded=60、pending=0、damaged=0、invalid=1。

[打开本轮结果](http://localhost:4173/?view=results&experiment=pilot-2026-09-06T15-27-17-103Z&suite=main)。

若从 Windows 通过 SSH 查看，在本地保持端口转发窗口开启：

```powershell
ssh -N -L 4173:127.0.0.1:4173 <服务器SSH别名>
```

本轮使用的入口：

```bash
bash /home/liukuan/Tencent-DB-Memory-Project/eval_kit/run-pipeline.sh \
  /home/liukuan/Tencent-DB-Memory-Project/eval_kit/configs/baseline-aligned-30.yaml
```

再次执行会创建新实验和新身份，不是打开现有结果。只查看本轮无需再运行评测。

本次新增独立[运行配置](../configs/baseline-aligned-30.yaml)及此报告；未继续优化提示词或修改工具实现。运行前的 32 项 Pipeline/Token 相关测试及 eval_kit TypeScript 检查通过。未执行 Git 提交或推送。

这些题已多次参与提示词分析，每类仅 10 题且单次运行，本轮还有一个无效样本。因此它适合检查现象，不适合直接作为正式总体结论。首次工具名称正确，也不证明参数、目标 Skill 内容或最终 Coding 都正确。

## 6. 逐任务对照

✓：正例首次工具符合原标签，或负例未调用。✗：选择不符、正例正常结束但未调用，或负例发生调用。超时单列，不作为普通 ✗ 计入指标。

| 任务 | Baseline | Native |
|---|---|---|
| `memory_008_python-fastapi` | tdai_read_scene ✓ | tdai_memory_search ✓ |
| `memory_099_memory-proxy-evaluation` | tdai_scenario_ls ✗ | tdai_memory_search ✓ |
| `memory_091_cli-file-processing` | skill_view ✗ | tdai_memory_search ✓ |
| `memory_033_redis-concurrency` | skill_view ✗ | tdai_memory_search ✓ |
| `memory_003_node-typescript-api` | tdai_memory_search ✓ | tdai_memory_search ✓ |
| `memory_084_observability-performance` | tdai_read_scene ✓ | tdai_memory_search ✓ |
| `memory_027_postgres-migrations` | tdai_memory_search ✓ | tdai_memory_search ✓ |
| `memory_050_testing-bugfix` | skill_view ✗ | tdai_memory_search ✓ |
| `memory_017_react-frontend` | tdai_memory_search ✓ | tdai_memory_search ✓ |
| `memory_081_document-rag` | tdai_memory_search ✓ | tdai_memory_search ✓ |
| `skill_043_api-auth-security` | skill_view ✓ | tdai_memory_search ✗ |
| `skill_003_node-typescript-api` | tdai_read_scene ✗ | 未调用 ✗ |
| `skill_085_observability-performance` | tdai_memory_search ✗ | tdai_memory_search ✗ |
| `skill_024_postgres-migrations` | skill_view ✓ | tdai_memory_search ✗ |
| `skill_036_message-queue-workers` | skill_view ✓ | 超时（无效） |
| `skill_029_redis-concurrency` | skill_view ✓ | tdai_memory_search → tdai_conversation_search ✗ |
| `skill_088_cli-file-processing` | skill_view ✓ | tdai_memory_search ✗ |
| `skill_052_testing-bugfix` | tdai_conversation_search ✗ | tdai_memory_search ✗ |
| `skill_008_python-fastapi` | skill_view ✓ | tdai_memory_search ✗ |
| `skill_071_browser-automation` | skill_view ✓ | tdai_memory_search ✗ |
| `none_066_browser-automation` | 未调用 ✓ | 未调用 ✓ |
| `none_097_memory-proxy-evaluation` | 未调用 ✓ | 未调用 ✓ |
| `none_052_cicd-release` | 未调用 ✓ | 未调用 ✓ |
| `none_036_message-queue-workers` | skill_view ✗ | 未调用 ✓ |
| `none_039_api-auth-security` | 未调用 ✓ | 未调用 ✓ |
| `none_047_testing-bugfix` | skill_view ✗ | 未调用 ✓ |
| `none_028_redis-concurrency` | skill_view ✗ | 未调用 ✓ |
| `none_004_node-typescript-api` | 未调用 ✓ | 未调用 ✓ |
| `none_012_python-fastapi` | skill_view ✗ | 未调用 ✓ |
| `none_061_docker-linux-ops` | 未调用 ✓ | tdai_memory_search ✗ |
