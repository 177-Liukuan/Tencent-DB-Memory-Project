# 45题：双组实际输入、工具调用与标签复核

实验：`pilot-2026-09-06T23-26-11-070Z`。复核日期：2026-09-07。

> 后续单题复审：memory_057 改为允许 Memory／Skill 双入口。之前忽略了实际 Skill 描述中的 release documentation 范围，详见 [memory_057 复审](memory-057-re-review.md)。下方汇总为此前重算结果，未随此次标签修订重算；最新四类分组规则见 [四类任务分组](../../docs/four-task-groups.md)。

## 结论

旧标签确实有错误，但不能把所有扣分都归因于标签。此次逐题复核45题，20题的类别或允许列表发生变化，全部45题重新说明逐工具理由。没有重跑模型、修改提示词、两组工具实现或评分公式。

现在这45题为 **Memory 13、Skill 18、None 14**，不再强求每类15题。正式数据集总数仍为285题，类别为 Memory 69、Skill 141、None 75；旧ID不改，统计以字段为准。

五项类别变更：

| 任务 | 变更 | 依据 |
| --- | --- | --- |
| memory_012 | Memory → Skill | 实际L3已完整给出注入AsyncClient及2.5秒总超时；剩下是异步集成与测试。 |
| memory_030 | Memory → Skill | 实际L3已给900秒TTL、禁止永久缓存及±15%抖动；不再缺历史参数，需实施缓存过期策略。 |
| none_096 | Skill → None | 只补已有URL解析函数的查询参数测试；注入映射Skill并不提供这项方法。 |
| none_009 | None → Skill | FastAPI返回类型参与响应契约，目录中的端点/响应模型流程相关。 |
| none_058 | None → Skill | 检查发布失败开关和action版本，属于发布门禁与依赖固定的部分审查；当前提示词要求部分相关也加载。 |

其余变更主要是补齐遗漏的场景读取入口及有实际历史缺口的双类入口。新增39个、移除9个允许列表条目，并非只扩大答案集合。

## 证据与判断口径

- 取回90份Langfuse实际模型输入，按45对核对：去掉不同Agent身份标签后，L3、L2目录正文一致，15个Skill的目录和顺序一致。
- 结合原始Bridge事件、CLI记录与当前源码。32次Baseline运行可从curl请求中读到业务参数；34次Native运行可从Bridge后端日志读到参数。其余运行不据此猜参数。Baseline请求参数与Native后端参数处在不同阶段，不能直接混为模型原始输出。
- 读取本轮准备的工作区、来源对话及Skill正文；没有用模型改过的运行工作区判断原题缺陷。
- 允许能推进任务的首次入口，不强制最短路径。但必须有具体信息缺口或适用方法；场景名称与项目同名并不自动使查历史合理。
- 当前指标仍按**首个到达Bridge的资产工具名称**计分；普通Read/Bash不计。不会因为稍后又选对工具而改写第一条记录，也不把工具名称分数解释成参数正确率或任务成功率。
- 这次是看过结果后的证据复核，不是新的独立盲审；旧标签、原始评分及盲审结论均保存。修正后的分数是同一批运行的重新解释，不能作为新一轮独立实验提升。

### 三类最重要的标签错误

1. **场景路径已经给出，却只允许搜索。** 新增历史题中的7题均实际获得相关L2路径。它们仍要求原话、批准或发生时间，L3不能完全替代原始依据，所以保留Memory，并允许搜索、读场景、先核对目录。目录和场景只能作为入口，不保证已经交付了引用。
2. **继续沿用旧一次提炼的“信息未注入”结论。** memory_012、030本轮的L3比此前更完整，不能继续写“超时/TTL未知”。相反，memory_043仍缺issuer，memory_015仍缺精确目录，memory_057仍缺release scope限制，不能一概删掉Memory。
3. **忽略任务对应的历史契约或误判Skill范围。** skill_079的表格字段、memory_046的登录响应字段、skill_011的依赖退出事务职责，均有当前L3未完整给出的具体约定，允许先读历史。none_096则只是本地正则测试，不能因属于评测项目就要求读注入映射Skill。

none_009与none_058属于偏简单的Skill正例，区分依据是当前实际适用描述和强加载提示词，而不是“任务是否难”。FastAPI会用返回注解进行响应校验和生成Schema，参见[官方响应模型说明](https://fastapi.tiangolo.com/tutorial/response-model/)。这和不改变语义的局部变量改名不同。若后续换成按需加载提示词，需重新审核这类边界题。

## 调用正确不等于执行正确

- **memory_007：两组都有时间语义问题。** 两组都把讨论发生时段传给`tdai_atomic_query`的`time_start/time_end`。Core过滤的是L1的`updated_time`，并不是L0消息时间，因此本题不把它当作对应时间查询入口。搜索或场景正文可先取得来源线索，最终仍需核对L0发送时间。不是因为Native用了该工具才排除，Baseline同样判定。
- **memory_042：工具入口正确，Native执行目标被覆盖。** Baseline curl提交了映射后的来源Session，当前Baseline Bridge保留它；Native Bridge后端日志却是当前评测Session，与`...inboundBody`后覆盖`session_id`的源码一致。不能据此说Native模型选错了Session，也不能因工具名称对就说查到了正确会话。Native还出现`limit=200`返回400、随后100返回200；Baseline在观测停止时CLI退出137，没有完整结果，不能宣称其执行成功。
- **none_082：名字对，不保证具体Skill对。** Native调用`skill_view`按现有公式得分，但读取的是`typescript-service-change-safety`，而本题直接匹配的是`bugfix-regression-workflow`。前者针对非平凡服务契约，此处单个数值API边界没有充分依据；此偏差单独记录，不暗改公式把它扣进当前名称指标。
- **memory_012、skill_018：首调扣分不等于没有发现Skill。** Native也读取了匹配Skill，但先到达Bridge的是Memory。现有采集对混合/并行请求的顺序敏感，不能把严格首调分数直接解释成模型只选了一个错误方向。
- **none_071：Baseline采集无效。** 180秒用于下载浏览器依赖后超时，没有完整观测，不作正确负例。Native读场景与纯函数任务的信息需求不符。

对应源码：

- [Native Bridge](/home/liukuan/Tencent-DB-Memory-Project/TencentDB-Agent-Memory-Native/MemoryProxy/src/memory/memory-bridge.ts:368)、[Baseline Bridge](/home/liukuan/Tencent-DB-Memory-Project/TencentDB-Agent-Memory-Baseline/MemoryProxy/src/memory/memory-bridge.ts:314)。
- [Core时间过滤](/home/liukuan/Tencent-DB-Memory-Project/TencentDB-Agent-Memory-Native/MemoryCore/src/gateway/v2-router.ts:1113)。
- [首次工具评分](../../metrics/tool.ts)、[观测汇总](../../bridge-eval/observations.ts)。

## 重算结果

| 指标 | Baseline | Native |
| --- | ---: | ---: |
| 有效观测 | 44/45 | 45/45 |
| 总有效调用率 | 93.55%（29/31） | 96.77%（30/31） |
| 总工具选择正确率 | **86.21%（25/29）** | **80.00%（24/30）** |
| Memory有效调用率 | 100%（13/13） | 100%（13/13） |
| Memory工具选择正确率 | 92.31%（12/13） | 84.62%（11/13） |
| Skill有效调用率 | 88.89%（16/18） | 94.44%（17/18） |
| Skill工具选择正确率 | 81.25%（13/16） | 76.47%（13/17） |
| None误调用率 | 23.08%（3/13） | 28.57%（4/14） |
| None中Memory误调用率 | 0%（0/13） | 21.43%（3/14） |
| None中Skill误调用率 | 23.08%（3/13） | 7.14%（1/14） |

总选择率原为Baseline 62.07%（18/29）、Native 60.71%（17/28）。两组都因标签修正上升，但不能称为模型优化收益。修正后Native总体少选对1题，分母还多1个已调用正例，因此不是简单比较“错了几次”。

Baseline的无效题恰好是Native发生误调用的负例。作为补充，仅取两组均有效的44对任务时，None误调用率两组均为 **3/13 = 23.08%**。主表保留现有公式各自剔除无效记录的口径，没有修改它。

静态Token不受标签变化影响：Baseline 4073、Native 2778，降幅31.79%。本轮是工具观测模式，端到端延迟有效样本为0，继续显示空值，不拿观测停止耗时冒充完整Coding延迟。

## 数据与结果如何保留

- 正式标签及逐工具理由：[任务JSONL](../tasks/tool_call_eval_v1.jsonl)。
- 本轮45题的旧标签、新标签、两组观测、判定理由、Langfuse引用：[逐题复核JSONL](pilot-45-label-review.jsonl)。
- 历史独立预审不改；最新结论追加在[审核总记录](ai-pre-review.jsonl)的`pilot45_review`，同步`final`及`tool_reason_review`。
- [90份输入与参数证据](../../results/pilot-2026-09-06T23-26-11-070Z/label-review-evidence.json)、同目录`input-review/`保留Langfuse快照；参数已经过白名单提取，不复制鉴权头。
- [原评分](../../results/pilot-2026-09-06T23-26-11-070Z/summary.before-label-review.json)、[原运行快照](../../results/pilot-2026-09-06T23-26-11-070Z/runs.before-label-review.json)、[新评分](../../results/pilot-2026-09-06T23-26-11-070Z/summary.json)。
- 只更新本轮90个`runs/*.json`里的标签字段；Query、调用名称/顺序、Session、工具事件、完成与超时状态、所有计时均不改。准备目录中的原冻结标签也不改，不重新执行已准备任务。

重算命令：

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
npm run score -- --experiment results/pilot-2026-09-06T23-26-11-070Z
```

最新结果仍在[Viewer](http://localhost:4173/?view=results&experiment=pilot-2026-09-06T23-26-11-070Z&suite=main)，刷新即可。原始results为本地实验产物，Git忽略不等于没有保存；备份实验时应连同results目录一起保留。

## 验证与剩余边界

- 全量测试230项通过；TypeScript检查通过。
- 90个运行对象除标签字段外逐项一致；两组核心仓库未修改，指标实现未修改。
- 新增30题中，本次只验证了7题的真实注入条件；另外23题仍标`needs_confirmation`，没有宣称完成全数据运行验证。
- 本轮标签依赖已冻结的Memory与当前提示词。再次提炼会改变L3是否给出答案及L2路径，尤其memory_012、030不宜当作脱离输入的永久类别。
- First-call观测不能检验最终引文、所有参数、后续顺序或任务完成。尤其Native的Session覆盖应后续单独修复，不在本轮数据审核中动核心代码。
- 这些是有证据的人工式裁定，部分Skill边界仍依赖当前“部分相关也必须加载”的规则；不是宣称存在唯一客观标签。正式报告应保留这项条件，并在下一批未看过的任务上检验结论。

## 45题逐项对照

工具缩写：MS=`tdai_memory_search`，CS=`tdai_conversation_search`，R=`tdai_read_scene`，LS=`tdai_scenario_ls`，CQ=`tdai_conversation_query`，AQ=`tdai_atomic_query`，V=`skill_view`，S=`skill_search`。表中“符合”仅指当前首次入口标准；参数与结果问题见对应说明。

| # | 任务 | 最终类别／允许首调 | Baseline | Native | 依据与判断 |
| --- | --- | --- | --- | --- | --- |
| 1 | memory_012_python-fastapi | skill：V、S | V；首调入口符合 | R→V；首调入口不符 | Memory→Skill：本轮 L3 完整给出原目标事实；Baseline 查看匹配 Skill，Native 首到为重复读取场景，随后也调用了正确 Skill。首调分数不等于 Native 完全没选中 Skill。 |
| 2 | memory_107_postgres-migrations | memory：MS、CS、R、LS | CS；首调入口符合 | LS；首调入口符合 | 补入实际可用的场景读取与目录入口。两组第一步都合理，但目录、L1 或 L2 不保证已经满足原话与出处要求；本轮按观测点停止，不能宣称最终引用正确。 |
| 3 | memory_127_cli-file-processing | memory：MS、CS、R、LS | R；首调入口符合 | MS；首调入口符合 | 补入实际可用的场景读取与目录入口。两组第一步都合理，但目录、L1 或 L2 不保证已经满足原话与出处要求；本轮按观测点停止，不能宣称最终引用正确。 |
| 4 | memory_116_testing-bugfix | memory：MS、CS、R、LS | CS；首调入口符合 | R；首调入口符合 | 补入实际可用的场景读取与目录入口。两组第一步都合理，但目录、L1 或 L2 不保证已经满足原话与出处要求；本轮按观测点停止，不能宣称最终引用正确。 |
| 5 | memory_042_message-queue-workers | memory：CQ、CS | CQ；首调入口符合 | CQ；首调入口符合 | 两组选 conversation_query 的方向正确，但实际查询不能据此认定正确：Baseline 请求了映射后的来源会话；Native Bridge 请求体里的 session_id 已是当前会话。Native limit=200 收到400，改100后200。已知 Bridge 覆盖 session_id 问题不通过改标签掩盖。 |
| 6 | memory_007_node-typescript-api | memory：MS、CS、R、LS | AQ；首调入口不符 | AQ；首调入口不符 | 两组均首先 atomic_query，并把2026-03-14讨论时段传入L1 time_start/time_end。该过滤对应记忆更新时间，不是讨论发生时间，不能据此筛历史决定。保留排除；搜索和场景正文可先找来源线索，但仍需核对L0时间。 |
| 7 | memory_030_redis-concurrency | skill：V、S | R；首调入口不符 | MS；首调入口不符 | Memory→Skill：旧理由“900秒未给出”被当前输入直接否定。两组继续查 Memory 不能算补足信息缺口；缓存过期策略与已关联 Redis Skill 部分相关。 |
| 8 | memory_120_docker-linux-ops | memory：MS、CS、R、LS | R；首调入口符合 | R；首调入口符合 | 补入实际可用的场景读取与目录入口。两组第一步都合理，但目录、L1 或 L2 不保证已经满足原话与出处要求；本轮按观测点停止，不能宣称最终引用正确。 |
| 9 | memory_123_document-rag | memory：MS、CS、R、LS | R；首调入口符合 | MS；首调入口符合 | 补入实际可用的场景读取与目录入口。两组第一步都合理，但目录、L1 或 L2 不保证已经满足原话与出处要求；本轮按观测点停止，不能宣称最终引用正确。 |
| 10 | memory_125_observability-performance | memory：MS、CS、R、LS | MS；首调入口符合 | R；首调入口符合 | 补入实际可用的场景读取与目录入口。两组第一步都合理，但目录、L1 或 L2 不保证已经满足原话与出处要求；本轮按观测点停止，不能宣称最终引用正确。 |
| 11 | memory_098_memory-proxy-evaluation | memory：MS、CS、R、LS、V、S | LS；首调入口符合 | MS；首调入口符合 | 两组入口均合理。Baseline path_prefix=评测 与实际路径前缀一致，不能复用旧实验中路径不同的结论。L3未明确overall，保留Memory主类。 |
| 12 | memory_043_api-auth-security | memory：MS、CS、R、LS、V、S | R；首调入口符合 | R；首调入口符合 | 两组 read_scene 路径正确，Native还读取api-security-review；保留Memory主类与双类入口。 |
| 13 | memory_015_react-frontend | memory：MS、CS、R、LS | R；首调入口符合 | R；首调入口符合 | 两组按实际目录读场景均合理；不能把L3的泛化feature描述当作完整目录约定。任务未要求复杂交互，不因为React技术栈便加入Skill。 |
| 14 | memory_057_cicd-release | 双入口：MS、CS、R、LS、V、S | R；首调入口符合 | V；首调入口符合 | 2026-09-07单题复审：Skill 描述包含发布文档，且两组要求加载部分相关 Skill，所以查看或搜索 Skill 也合理；仓库 scope 约定仍需 Memory 核对。旧裁定已保留，历史汇总未重算。 |
| 15 | memory_122_browser-automation | memory：MS、CS、R、LS | R；首调入口符合 | LS；首调入口符合 | 补入实际可用的场景读取与目录入口。两组第一步都合理，但目录、L1 或 L2 不保证已经满足原话与出处要求；本轮按观测点停止，不能宣称最终引用正确。 |
| 16 | none_035_message-queue-workers | skill：V、S | R；首调入口不符 | MS；首调入口不符 | 两组先查Memory均没有明确的信息缺口；本地类型与worker足以选具体边界，适用方法来自message-worker-reliability。 |
| 17 | skill_071_browser-automation | skill：V、S | V；首调入口符合 | V；首调入口符合 | 两组均读取browser-use，符合任务方法需求。 |
| 18 | skill_025_postgres-migrations | skill：V、S | V；首调入口符合 | V；首调入口符合 | 两组工具及已查看Skill匹配。资源文件选择、最终迁移正确性不由首调指标保证。 |
| 19 | skill_018_react-frontend | skill：V、S | V；首调入口符合 | R；首调入口不符 | Baseline读取React Skill直接匹配。Native先到达的是场景读取，但同轮也读取React Skill；严格首调分数不代表没找到正确Skill。不为吸收这次结果而虚构历史信息缺口。 |
| 20 | none_089_cli-file-processing | skill：V、S | V；首调入口符合 | V；首调入口符合 | 两组读取CLI安全Skill均合理。 |
| 21 | none_096_memory-proxy-evaluation | none：无 | V；不必要资产调用 | 无；不调用符合 | Skill→None。旧理由把项目名等同于Skill适用范围。Baseline读取注入映射Skill并非本题所需；Native没有资产调用，符合本地测试任务。 |
| 22 | none_063_docker-linux-ops | skill：V、S | V；首调入口符合 | 无；未调用相关资产工具 | 保持Skill。Baseline读取docker-linux-deployment，Native直接修改未读Skill；按当前强加载规则属于漏调用，不等于编码结果错误。 |
| 23 | skill_059_cicd-release | skill：V、S | V；首调入口符合 | V；首调入口符合 | 两组均读取safe-release-pipeline。 |
| 24 | skill_051_testing-bugfix | skill：V、S | V；首调入口符合 | V；首调入口符合 | 两组读取回归测试流程合理；素材没有共享全局fixture，本次理由明确这一事实，不伪称已复现旧缺陷。 |
| 25 | none_082_observability-performance | skill：V、S | 无；未调用相关资产工具 | V；首调入口符合 | Native的工具名skill_view得分，但实际读取的是typescript-service-change-safety，未读取直接匹配的bugfix流程；这是参数/具体Skill选择偏差。Baseline未调用，漏掉当前相关Skill。 |
| 26 | skill_079_document-rag | skill：V、S、MS、CS、R、LS | R；首调入口符合 | V；首调入口符合 | 原标签漏掉有依据的历史入口。Baseline读取场景可取得表格字段约束，Native读取Docling取得审查方法，均能推进任务。 |
| 27 | memory_046_api-auth-security | skill：V、S、MS、CS、R、LS | R；首调入口符合 | LS；首调入口符合 | Baseline读正文、Native列目录都是核对既有响应契约的入口。目录本身未完成请求，仍不能凭首调判断安全修改成功。 |
| 28 | skill_005_node-typescript-api | skill：V、S | V；首调入口符合 | V；首调入口符合 | 两组均读取匹配的TypeScript契约Skill。 |
| 29 | skill_029_redis-concurrency | skill：V、S | R；首调入口不符 | V；首调入口符合 | Baseline读场景是在重复核对已给锁参数，Native读取Redis Skill更直接。保持Skill，不把所有与项目同名的场景都视为必需历史入口。 |
| 30 | skill_011_python-fastapi | skill：V、S、MS、CS、R、LS | R；首调入口符合 | R；首调入口符合 | 两组读取场景可先核对生命周期约束，再实施FastAPI依赖改造；旧标签排除了合理的Memory入口。 |
| 31 | none_002_node-typescript-api | none：无 | 无；不调用符合 | 无；不调用符合 | 两组均无资产调用，符合。 |
| 32 | none_074_document-rag | none：无 | 无；不调用符合 | 无；不调用符合 | 两组均无资产调用，符合。 |
| 33 | none_099_memory-proxy-evaluation | none：无 | V；不必要资产调用 | V；不必要资产调用 | 两组读取typescript-service-change-safety均超出本题需要。不能因两组都调用就改为正例。 |
| 34 | none_046_testing-bugfix | none：无 | 无；不调用符合 | 无；不调用符合 | 两组均无资产调用，符合。 |
| 35 | none_044_api-auth-security | none：无 | 无；不调用符合 | 无；不调用符合 | 两组均无资产调用，符合。 |
| 36 | none_032_message-queue-workers | none：无 | 无；不调用符合 | 无；不调用符合 | 两组均无资产调用，符合。 |
| 37 | none_025_redis-concurrency | none：无 | 无；不调用符合 | 无；不调用符合 | 两组均无资产调用，符合。 |
| 38 | none_080_observability-performance | none：无 | V；不必要资产调用 | 无；不调用符合 | Baseline读取TypeScript服务Skill属于额外调用；Native无资产调用符合。 |
| 39 | none_071_browser-automation | none：无 | 无；采集无效，不评分 | R；不必要资产调用 | Baseline安装浏览器超时，采集无效，不能记作正确不调用；Native先读浏览器历史没有对应缺口。 |
| 40 | none_013_react-frontend | none：无 | 无；不调用符合 | R；不必要资产调用 | Baseline无资产调用符合；Native读取前端场景没有信息缺口，后续React Skill同样非必需。 |
| 41 | none_009_python-fastapi | skill：V、S | V；首调入口符合 | V；首调入口符合 | None→Skill。按当前端点/响应模型适用描述和部分相关必须加载规则，两组查看FastAPI Skill有依据。此题简单，但不宜作为确定负例。 |
| 42 | none_061_docker-linux-ops | none：无 | 无；不调用符合 | 无；不调用符合 | 两组均无资产调用，符合。 |
| 43 | none_087_cli-file-processing | none：无 | 无；不调用符合 | 无；不调用符合 | 两组均无资产调用，符合。 |
| 44 | none_023_postgres-migrations | none：无 | 无；不调用符合 | MS；不必要资产调用 | Baseline无资产调用符合；Native搜索已明确的三个状态属于重复查询。 |
| 45 | none_058_cicd-release | skill：V、S | 无；未调用相关资产工具 | V；首调入口符合 | None→Skill。旧理由把所有限定检查都当作无关文本搜索，但continue-on-error和action版本实际对应发布规则；Native读取该Skill合理，Baseline未加载。 |
