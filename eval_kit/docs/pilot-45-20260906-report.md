# 最新45题双组评测报告

> 后续已复核45题标签并重算，见[标签与调用对照报告](../dataset/review/pilot-45-label-review-report.md)。下文保留运行前冻结标签的原始结果，不代表当前Viewer分数；没有重跑本轮评测。

实验：`pilot-2026-09-06T23-26-11-070Z`。2026-09-06至09-07（UTC）。

## 1. 结论

Memory、Skill、None各15题，两组共90次运行均已执行，89次观测有效。Baseline有1次浏览器依赖下载超时；Native无无效记录。流水线因存在无效运行最终返回非零，报告及全部记录已经保存，不是中途只跑了一部分。

按运行前冻结标签，Native整体工具选择正确率比Baseline低1.35个百分点，Skill条件选择率略高，但两组实际选对的Skill题数同为9题。Native在None题的调用倾向更强。静态工具说明Token减少31.79%。

这不能直接解释为Native的真实选择能力下降：7道新Memory题中，实际System已注入相关场景路径，原标签却只接受搜索，遗漏了合理的场景读取入口。下面同时报告原始分数和标签局限，没有改标签或按新标签重算本轮结果。

## 2. 运行条件与公平性

- 当前工作区源码：Baseline `de3f1cc604d6cd2580b127cb8cf66041846c88e7`，Native `9a14af1189bb3c77882bc067364a94d15fe8b2cf`。运行前后两仓库均无源码diff，未拉取远端或修改核心逻辑。
- Claude Code 2.1.263；DeepSeek v4 flash，两组同一客户端镜像、模型配置。CLI设置关闭思考，准备进程明确disabled；90份Langfuse输入均未声明thinking，不能据此保证上游实际关闭推理模式。
- 从当前285题按最新类别抽样，不按ID前缀；固定种子 `pilot-45-20260906`，各类先覆盖15个场景。7题来自新增30题。
- 每组一个Team，每题独立Agent、Task、Session及可写工作区；共90个独立Session。拥有者为 `rhino-researcher / usr-f7iwo2muhb`，可在管理页查看私有资产。
- 两组Team分别为 `team-84pyh3eomn`、`team-84pyglqgcu`。
- 每个Agent导入全部15个Skill；45对正文/资源和Memory配对检查通过；90份实际模型输入取回成功，45对Skill目录及顺序一致。
- Memory只生成一份再复制；22份缓存未命中、23份命中。全部使用4096输出预算、BM25/embedding=none，无输出截断，不修改生产调度延迟。原数据集工作区不作为执行目录。
- `tool_calls`模式：首次Bridge观测后停止；两组交替先跑，单次上限180秒。真实服务，不使用Mock返回。

## 3. 冻结标签下的指标

| 指标 | Baseline | Native |
| --- | --- | --- |
| 有效运行 | 44/45 | 45/45 |
| 总体有效调用率 | 96.67%（29/30） | 93.33%（28/30） |
| Memory有效调用率 | 100%（15/15） | 100%（15/15） |
| Skill有效调用率 | 93.33%（14/15） | 86.67%（13/15） |
| 总体工具选择正确率 | 62.07%（18/29） | 60.71%（17/28） |
| Memory工具选择正确率 | 60.00%（9/15） | 53.33%（8/15） |
| Skill工具选择正确率 | 64.29%（9/14） | 69.23%（9/13） |
| None任意资产工具误调用率 | 21.43%（3/14） | 40.00%（6/15） |
| None中Memory误调用率 | 0%（0/14） | 20.00%（3/15） |
| None中Skill误调用率 | 21.43%（3/14） | 20.00%（3/15） |
| 静态注入Token | 4073 | 2778 |

静态Token用相同cl100k_base及统计边界，包括固定System工具说明、Native Schema，不包含动态记忆、Skill正文、Query或返回结果，不等于计费Token。降幅31.79%。

有效调用率只问是否出现任意目标资产工具调用，Memory题先调Skill仍算已调用，再由选择率判断入口。选择率只在已调用正例上计算，因此不能因为Native的9/13大于Baseline的9/14就说Native正确完成了更多Skill题；覆盖全部15题时两组均为9/15。

Baseline的None分母为14，因为超时不能算成正确的不调用。仅看两组均有效的14道None题，Baseline误调用3/14，Native5/14；这是补充配对视角，未替换现有汇总公式。

本轮不报告端到端延迟：观测模式提前结束大多数调用，结果中延迟为空。部分负例虽返回最终回答，也不能单独拿它们代表全体任务的端到端性能。

## 4. 哪些差异不能直接解释成模型选错

### 4.1 新Memory题：实际路径存在，静态允许列表不完整

7题都生成了L0～L3，实际输入有对应L2索引。L3已给出多项主要结论，但任务要求原话、时间、批准或出处，摘要不自动等价于原始依据。

| Task | 实际System中的场景路径 | Baseline首调用 | Native首调用 |
| --- | --- | --- | --- |
| memory_107 | 数据迁移-单据映射管理.md | conversation_search | scenario_ls |
| memory_127 | 审议规则-操作交接归属.md | read_scene | memory_search |
| memory_116 | 业务审计-取值口径与规则核对.md | conversation_search | read_scene |
| memory_120 | 安全合规与证据处置.md | read_scene | read_scene |
| memory_123 | 法务采购-文档授权边界管理.md | read_scene | memory_search |
| memory_125 | 事故报告-信息分级与对外脱敏.md | memory_search | read_scene |
| memory_122 | 数据管理-演示数据恢复方案.md | read_scene | scenario_ls |

表中Memory工具省略tdai_前缀。其中文件主题与任务明确对应，读取相关正文是合理的资料入口，不应仅因静态阶段没有路径证据就长期排除。列目录比直接读多一步，但需要与参数及返回内容一起判断，不能仅凭工具名视作毫不相关。

原话、出处核对可能仍需后续L0检索。本轮首次到Bridge即停止，不能证明已经找全证据、调用参数正确或最终回答正确。此次仅形成修订建议，没有修改数据。

### 4.2 时间语义问题与场景入口问题不同

memory_007两组均先用tdai_atomic_query，任务要求按历史事件发生时间整理决定，而该工具的时间条件针对L1记录更新时间。两种时间不能混同；需要检查参数及后续出处验证，不能只因两组都这么做就恢复旧标签，也不能由首调用证明最终一定答错。

memory_042两组均选择conversation_query，符合任务的会话顺序读取意图；既有Bridge覆盖session_id的执行限制仍未修复。本轮计的是发起调用，不验证该后端已正确读取目标会话。

### 4.3 Skill题仍混有项目约定需求

- none_035：两组都先查Memory。实际场景索引包含账单事件schema、兼容性和测试约定，与新增事件fixture有关，不能仅以旧ID或Skill类别否定其相关性。
- skill_018：Native先读前端场景。实际索引明确包含性能与可访问性约定，应进一步区分项目约束读取与通用优化方法；Baseline先读Skill也合理。
- skill_079：Baseline先读文档场景，Native先读Skill；实际场景含表格、页码、VLM和解析规则，与任务相关。
- memory_046：两组都查认证Memory，实际场景含账号枚举防护、统一响应和认证约定。
- skill_011：两组都读后端场景，实际索引含UnitOfWork及团队事务规范，可能是重构依赖生命周期前的相关资料。

这些是再次审核“只允许Skill首调用”的依据，不是自动判定所有Memory工具都应该放行。当前观测不检查参数，不能确认读到了正确内容。

Native两道未调用正例是none_096（补URL查询参数测试）和none_063（修改APP_ENV）；Baseline未调用正例为none_082（百分位边界检查）。这些任务本身较轻，标签反映的是相关Skill加载规则，不等同于不读Skill就无法完成。

### 4.4 None组的差异更值得优先跟进

Baseline触发：none_099、none_080、none_009，均为Skill。

Native触发：none_099、none_009、none_058为Skill；none_071、none_013、none_023为Memory。

对于变量改名、类型注解、规则已经给全的静态检查，Memory调用的必要性较弱。Skill则仍受“部分相关也加载”的共有提示词影响，需逐题区分真正有用的流程与过宽覆盖。不能仅为了降低误调用率就在本轮删工具或改标签。

## 5. 实际问题与处理

1. **Baseline管理页面启动失败**：Linux用户的inotify监听配额耗尽，Vite抛ENOSPC。仅为该用户服务新增本地CHOKIDAR轮询配置，未改项目代码；重启后页面200，10个应用服务全部健康。共享ClickHouse/Langfuse容器保持运行，没有在评测期间重启数据库。
2. **Baseline none_071超时**：原始CLI先安装npm依赖、尝试Playwright测试，再运行 `npx playwright install chromium`；180秒内未结束。没有Proxy调用，标记无效，不作为正确None。未重跑覆盖，未扩展时限。后续应统一预装浏览器依赖或使用确实不依赖浏览器的函数测试。
3. **早期Langfuse记录暂未齐全**：中途读取时一份输入不可用，最终收集90份全部成功，符合观测上报存在延迟；没有因此补跑模型。
4. **CLI关闭思考不等于上游明确关闭**：实际请求的thinking字段均未声明，本轮不声称完全无推理Token。

未发现导致本轮无效运行的Native 409/502/503错误；但首次观测即停止，不覆盖完整Tool Result重入、跨轮恢复和compact，不能用本轮证明这些核心路径全部无缺陷。

## 6. 逐题结果

以下“符合/不符”均指冻结标签，不是对最终业务正确性的判断。顺序是Bridge到达顺序，不是模型生成顺序。

| 序号 | Task | 冻结类别 | Baseline | Native |
| --- | --- | --- | --- | --- |
| 1 | memory_012_python-fastapi | memory | skill_view；符合标签 | tdai_read_scene → skill_view；符合标签 |
| 2 | memory_107_postgres-migrations | memory | tdai_conversation_search；符合标签 | tdai_scenario_ls；选择不符 |
| 3 | memory_127_cli-file-processing | memory | tdai_read_scene；选择不符 | tdai_memory_search；符合标签 |
| 4 | memory_116_testing-bugfix | memory | tdai_conversation_search；符合标签 | tdai_read_scene；选择不符 |
| 5 | memory_042_message-queue-workers | memory | tdai_conversation_query；符合标签 | tdai_conversation_query；符合标签 |
| 6 | memory_007_node-typescript-api | memory | tdai_atomic_query；选择不符 | tdai_atomic_query；选择不符 |
| 7 | memory_030_redis-concurrency | memory | tdai_read_scene；符合标签 | tdai_memory_search；符合标签 |
| 8 | memory_120_docker-linux-ops | memory | tdai_read_scene；选择不符 | tdai_read_scene；选择不符 |
| 9 | memory_123_document-rag | memory | tdai_read_scene；选择不符 | tdai_memory_search；符合标签 |
| 10 | memory_125_observability-performance | memory | tdai_memory_search；符合标签 | tdai_read_scene；选择不符 |
| 11 | memory_098_memory-proxy-evaluation | memory | tdai_scenario_ls；选择不符 | tdai_memory_search；符合标签 |
| 12 | memory_043_api-auth-security | memory | tdai_read_scene；符合标签 | tdai_read_scene；符合标签 |
| 13 | memory_015_react-frontend | memory | tdai_read_scene；符合标签 | tdai_read_scene；符合标签 |
| 14 | memory_057_cicd-release | memory | tdai_read_scene；符合标签 | skill_view；选择不符 |
| 15 | memory_122_browser-automation | memory | tdai_read_scene；选择不符 | tdai_scenario_ls；选择不符 |
| 16 | none_035_message-queue-workers | skill | tdai_read_scene；选择不符 | tdai_memory_search；选择不符 |
| 17 | skill_071_browser-automation | skill | skill_view；符合标签 | skill_view；符合标签 |
| 18 | skill_025_postgres-migrations | skill | skill_view；符合标签 | skill_view；符合标签 |
| 19 | skill_018_react-frontend | skill | skill_view；符合标签 | tdai_read_scene；选择不符 |
| 20 | none_089_cli-file-processing | skill | skill_view；符合标签 | skill_view；符合标签 |
| 21 | none_096_memory-proxy-evaluation | skill | skill_view；符合标签 | 无调用；漏调用 |
| 22 | none_063_docker-linux-ops | skill | skill_view；符合标签 | 无调用；漏调用 |
| 23 | skill_059_cicd-release | skill | skill_view；符合标签 | skill_view；符合标签 |
| 24 | skill_051_testing-bugfix | skill | skill_view；符合标签 | skill_view；符合标签 |
| 25 | none_082_observability-performance | skill | 无调用；漏调用 | skill_view；符合标签 |
| 26 | skill_079_document-rag | skill | tdai_read_scene；选择不符 | skill_view；符合标签 |
| 27 | memory_046_api-auth-security | skill | tdai_read_scene；选择不符 | tdai_scenario_ls；选择不符 |
| 28 | skill_005_node-typescript-api | skill | skill_view；符合标签 | skill_view；符合标签 |
| 29 | skill_029_redis-concurrency | skill | tdai_read_scene；选择不符 | skill_view；符合标签 |
| 30 | skill_011_python-fastapi | skill | tdai_read_scene；选择不符 | tdai_read_scene；选择不符 |
| 31 | none_002_node-typescript-api | none | 无调用；符合标签 | 无调用；符合标签 |
| 32 | none_074_document-rag | none | 无调用；符合标签 | 无调用；符合标签 |
| 33 | none_099_memory-proxy-evaluation | none | skill_view；误调用 | skill_view；误调用 |
| 34 | none_046_testing-bugfix | none | 无调用；符合标签 | 无调用；符合标签 |
| 35 | none_044_api-auth-security | none | 无调用；符合标签 | 无调用；符合标签 |
| 36 | none_032_message-queue-workers | none | 无调用；符合标签 | 无调用；符合标签 |
| 37 | none_025_redis-concurrency | none | 无调用；符合标签 | 无调用；符合标签 |
| 38 | none_080_observability-performance | none | skill_view；误调用 | 无调用；符合标签 |
| 39 | none_071_browser-automation | none | 无效：超时 | tdai_read_scene；误调用 |
| 40 | none_013_react-frontend | none | 无调用；符合标签 | tdai_read_scene；误调用 |
| 41 | none_009_python-fastapi | none | skill_view；误调用 | skill_view；误调用 |
| 42 | none_061_docker-linux-ops | none | 无调用；符合标签 | 无调用；符合标签 |
| 43 | none_087_cli-file-processing | none | 无调用；符合标签 | 无调用；符合标签 |
| 44 | none_023_postgres-migrations | none | 无调用；符合标签 | tdai_memory_search；误调用 |
| 45 | none_058_cicd-release | none | 无调用；符合标签 | skill_view；误调用 |

## 7. 查看与复现

- [本轮Viewer](http://localhost:4173/?view=results&experiment=pilot-2026-09-06T23-26-11-070Z&suite=main)
- [原始汇总](../results/pilot-2026-09-06T23-26-11-070Z/summary.json)
- [90次运行报告](../results/pilot-2026-09-06T23-26-11-070Z/report.md)
- [实际输入索引](../results/pilot-2026-09-06T23-26-11-070Z/input-review/index.json)
- [配对准备检查](../results/preparation/pilot-2026-09-06T23-26-11-070Z/pair-checks.json)
- [身份与客户端泄漏检查](../results/pilot-2026-09-06T23-26-11-070Z/pipeline-audit.json)
- [运行配置](../configs/pilot-45.yaml)

下一次独立实验可运行：

```bash
bash eval_kit/run-pipeline.sh eval_kit/configs/pilot-45.yaml
```

这会新建实验和Agent，不是恢复本次运行。当前实验无需重跑。启动配置显式restart_proxies=false，是因为本轮执行前已人工重启全部应用服务；下次若修改源码，应先重启服务，或将该选项设为true以重启Proxy。

本轮只新增评测配置、报告及运行产物，未改数据标签、评分公式或两组工具实现，未提交或推送。
