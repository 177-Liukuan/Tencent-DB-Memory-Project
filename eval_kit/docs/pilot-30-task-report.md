# 修订数据集与 30 Task 实测报告

已完成。实验编号 `pilot-2026-09-05T18-38-31-734Z`。30 题 × 两组共 60 次真实运行，60 次工具观测有效，未重跑或替换样本。CLI 阶段为 2026-09-05 19:07:34～19:32:39 UTC，约 25 分 05 秒；包括数据准备的 Pipeline 约 54 分钟。

结论：修订数据可以跑通当前评测流程，但还不能作为正式工具必要性实验的数据定稿。关键问题已从资产缺失、标签泄漏和评分不一致，转向自动注入答案、Skill 标签含义及真实检索环境的控制。

## 范围和固定配置

抽取 Memory / Skill / None 各 10 题，覆盖 15 个项目场景，两组共 60 次真实 Claude Code 运行。选择在运行前由 `sample_seed: pilot-30-20260905` 固定；不按模型结果换题。只包含 Main，不含 15 条 Memory Probe。

- Claude Code 2.1.261；模型 `deepseek-v4-flash[1m]`；共享镜像 `tdai-eval-cli:node22-py312`。
- 工具观测在第一条 Bridge 发起事件后停止，不等待完整 Coding 任务。每次最多 180 秒；无调用且超时不当作有效负例。
- 每题两组使用同一份提炼结果、同一组 Skill 和相同初始资产，但各有独立用户、Team、Agent、Session 及可写工作区。
- Core 保留原 BM25、embedding=none。独立准备程序直接顺序执行 L1/L2/L3，不使用生产调度等待，也不修改原工具逻辑。
- 本轮 30 次准备均使用 4096，截断事件为 0，未提高上限。CLI 设置了关闭 thinking，但实际仍收到 thinking 输出，不能称为非思考模型实验。

## 数据准备的实际结果

30 个 Task 各提炼一次，再复制到对应两组；不是让两组各自重新调用模型提炼。30 对均通过内容核对及 API 读回：每个 Agent 有 40 条 L0 消息、15～20 条 L1 记录及完整场景和画像。L1 数量因任务的提炼结果不同而变化，但同一题的两组完全一致。

独立提炼平均 49.27 秒，最快 45.06 秒、最慢 58.53 秒，合计 24 分 38 秒。30 次调度空等均为 0；这仍是使用原 Core 函数生成的真实记忆，不是手工固定工具返回值。准备、导入时间不计为模型任务延迟。

## 已完成的数据和套件修订

1. 300 个工作区移除类别编号；README 去掉“benchmark”“故意不提供历史决定”等说明。业务 fixture 值保留。
2. Main 的 185 条正例使用允许的首次工具集合，与首次调用停止一致。Skill 可直接 view；Memory 可查 L0、L1 或读已知场景正文。Probe 仍单列。
3. 三类任务在同一场景下均有相同的六个 Skill 候选；源候选顺序不当作最终服务端顺序。
4. Docling 参考文档移至可导入目录；查询前校验实际导入器能找到所有期望资源。
5. 修正两条 Skill Query 的错误能力或问题前提，十条 Memory Query 移除直接给出的目标规则，None 减少标签式措辞；合计修改 35 条 Query（含五条时间范围调整）。
6. 原 90 条核心决定逐字保留；510 条编号填充替换为 210 条业务讨论。当前为 300 轮 / 600 条消息，每会话 20 轮，目标分布在前、中、后部，所有引用随之更新。
7. 采样支持固定 seed、超过场景数的任务数量和 `per_family: all`；不会再因“只有 15 个场景”拒绝全量 Main。
8. 增加模型输入审核材料：动态 Memory、候选顺序、目标事实；字符串未匹配不自动认定“答案不在输入里”。

详细说明见 [数据修订记录](../dataset/review/v2-revision.md)。修订前上传内容的完整副本位于本机 `eval_kit/results/dataset-v2-before-20260905/`。

## 数据准备中已确认的问题

### 自动注入已经包含部分目标答案

已读回十条 Memory 题的两组首次 Langfuse 输入。L3 正文和 L2 目录逐项一致；两组固定引导文字、Agent ID 不同，所以不能比较整个 System 的字节相等。

| 本轮编号 | 目标 | 首次输入人工检查 |
|---|---|---|
| 01 | uv 依赖与锁文件约定 | 部分：已有 uv 和两份文件名，未完整重述部署版本管理 |
| 02 | 混合工具原始顺序 | 关键规则完整出现 |
| 03 | CLI 退出码 | 2 / 3 / 1 的对应关系已出现 |
| 04 | 缓存 TTL 抖动 | ±15% 已出现 |
| 05 | 订单响应包装 | envelope、request_id、data 已出现 |
| 06 | Prometheus label | 部分：已有防高基数、路由归一化，未逐项列出禁止字段 |
| 07 | 数据库迁移回滚 | 独立回滚与验证 SQL 已出现 |
| 08 | 缺陷修复顺序 | 先有失败回归测试、后修复的规则已出现 |
| 09 | 用户徽标主题 token | 部分：只有主题 token 化原则，没有两个具体 token 名 |
| 10 | 扫描件解析流程 | VLM / standard 的选择已出现 |

这里的“关键规则已出现”是人工阅读判断，不是字符串完全相等，也不等于代码已经能正确完成。7 条关键规则已出现、3 条部分出现，不能把十条都当成确定缺少外部信息的正例。

因此本轮保留预先声明的标签统计，同时单独审核首次真实输入。对输入已足够的案例，不将“不查询”解释为模型不知道什么时候需要工具，也不据此宣称 Native 有效调用率下降。没有关闭自动注入、替换样本或在看到结果后改标签。

### 原始日期矛盾

检查发现 10 份源对话时间早于正文已发生的复盘事件。例如 `memory_099` 的源消息时间在 2 月，正文描述 8 月事故。本轮不含时间查询 Probe，两组使用相同冻结内容。运行结束后，已将这 10 份源对话日期移到所述事件之后，并更新其复查日期；90 条核心决定、消息顺序和 Task 目标引用均未改变。新增日期测试先复现十份失败，修正后通过。

这项日期修订**没有重新用于本轮提炼**。本轮输入保存在 preparation 下的 `inputs/` 与 `cases.jsonl`；后续一键运行会使用修正后的数据源，不得把二者写成同一数据版本。具体为 auth 4/23、browser 6/23、CI 5/23、CLI 8/9、Docker 6/9、document 7/9、eval 8/23、queue 4/9、observability 7/23、testing 5/9（均 2026 年）。

## 结果与问题跟踪

### 运行代码与磁盘代码不一致（已修复部署状态）

两组 Proxy 原进程均于 11:38 启动，但 Native 工具恢复修复文件于 15:21 更新。仅执行 `systemctl start` 不会重载已运行进程。CLI 评测开始前已重启两组 Proxy；Native 于 18:59、Baseline 于 19:00 加载当前源码，健康检查及埋点均通过。Core 数据准备没有重做。

Baseline 重启一度被 `lab/bin/preflight` 拒绝：部署检查还写着 `41306b1`，而已登记的埋点提交为 `de3f1cc`。核对二者差异只有 Bridge 观测相关代码后，更新部署校验版本；未放宽为任意提交，也未修改业务逻辑。新配置加入显式 `restart_proxies`，默认 false，专用评测示例设 true。

### 输入审核误读 Baseline（已修复评测代码）

新审核程序最初只读取请求对象的 `system`，但 Baseline Langfuse 实际存的是含 `role: system` 的消息数组，导致审核材料错误显示空 Memory 和空候选。补充失败测试后支持实际数组格式，仅提取 System、不读取 User 正文；重采集已有观测即可，不重跑 CLI。静态 Token 原有解析已支持数组，未受这个新审核程序的问题影响。

### 原 BM25 的检索边界（确认，不改工具核心）

只读检查两组 Core：查询“高基数”都返回 0，但目标 L1 存在；换成 `Prometheus label` 两组均命中。原 SQLite FTS 的中文分词使“高基数字段”和短词“高基数”分成不同 token。

另一次“回归测试”查询，同一题两组的 L1 内容相同，但返回 15 / 16 条。原因是原 Core 先从全库取 BM25 前若干条，再过滤当前 Agent；两库已有历史内容不同，会挤占全库候选。以本次查询为例，两组当前 Agent 各有 16 条匹配，进入全局前 300 条的分别为 15 和 16 条。不是数据复制漏了一条。

本轮停止在第一次工具发起，不用返回条数评价模型选择，因此保留当前真实系统。后续如果测检索质量或完整延迟，应使用同样的干净数据库，或另开任务修正“先限定 Agent 再截断”的查询逻辑，不能仅凭初始 Agent 数据相等就断言所有检索响应等价。

### DeepSeek 思考输出（确认，未中途改变条件）

客户端已设置 `MAX_THINKING_TOKENS=0` 和 `alwaysThinkingEnabled=false`，但 `task-18-baseline` 的真实流仍出现超过 10,000 个估算 thinking tokens；该条耗时 175.90 秒才触发 `skill_view`，没有因为接近上限而丢弃已发生调用。当前自定义模型路径的 CLI 开关不能确保上游关闭思考。两组本轮保持相同配置，未中途换模型或参数；后续若要求非思考实验，应先验证实际请求/响应，再开始新实验。

全量读回共有 49/60 次 CLI 记录出现非零 thinking 估算（Baseline 30、Native 19）。这是客户端可见输出，Native 内部轮次未必下发给客户端；不能据此比较两组真实思考 Token，更不能把其余记录解释为上游思考已关闭。

### 两组固定调用引导仍不同（保留现有实现）

Baseline 的 Skill 目录标题是 `Skills (mandatory)`，要求相关或部分相关时也先加载；Native 的目录主要说明云端 Skill 与读取方法。这是当前两项目已有的提示词差异，见各自 `MemoryProxy/src/injection/injectors/skill-injector.ts`，本轮没有修改。

因此这里比较的是现有两套完整工具方案，不是“只变更执行位置，其他文案完全相同”的单变量实验。它可能影响 Skill 正例使用率和 None 误调用，但本轮不能单独证明因果；正式报告需要明确这一控制变量边界。

## 统计口径

本轮主评测只看第一次到达 Memory/Skill Bridge 的工具发起事件。有效调用率的分母是已声明的正例；调用任一 Memory/Skill 即计“已调用”，随后由工具选择正确率判断第一次工具是否属于允许集合。不能把“某类正例发生了任意工具调用”读成“该类工具已正确使用”。

同一轮几项调用可能在停止命令生效前一同到达，均保存原始记录；主选择分数只取第一项。同一 Native `call_id` 的 Bridge 重试去重，不合并两个不同 ID 的同名调用。这里的先后是 **Bridge 接收顺序**，并发时不承诺等于模型生成顺序。

None 题只有在正常输出结束且没有调用时才算有效的不调用；超时或 API 错误且没有调用的记录必须另列。主动在工具事件处停止的 `completed=false` 表示没有测完 Coding，不是观测失败。本轮不报告完整 Coding 正确率或两组端到端加速比。

### 实际指标

以下完全按照运行前的标签计算，没有根据首次输入审核结果事后改标签。

| 指标 | Baseline | Native |
|---|---:|---:|
| 有效观测 | 30/30 | 30/30 |
| 正例发生任意 Proxy 调用 | 20/20（100%） | 20/20（100%） |
| Memory 正例发生任意 Proxy 调用 | 10/10（100%） | 10/10（100%） |
| Skill 正例发生任意 Proxy 调用 | 10/10（100%） | 10/10（100%） |
| 首次工具选择正确率，总体 | 15/20（75%） | 12/20（60%） |
| 首次工具选择正确率，Memory | 6/10（60%） | 7/10（70%） |
| 首次工具选择正确率，Skill | 9/10（90%） | 5/10（50%） |
| None：任意 Proxy 工具误调用 | 6/10（60%） | 4/10（40%） |
| None：Memory 工具误调用 | 1/10（10%） | 2/10（20%） |
| None：Skill 工具误调用 | 5/10（50%） | 2/10（20%） |

合计 50 次运行在观测点主动停止，10 次正常结束且没有 Proxy 调用；共保存 53 条归一化 Bridge 事件。3 次 Native 运行在停止生效前收到两条调用，因此事件数不是调用案例数。无超时导致的无效样本，无案例被丢弃。

### 如何看这些结果

Native 的 Memory 题都先用了 Memory 类工具，但其中 3 题先刷新场景目录 `tdai_scenario_ls`，不属于这批已有场景目录的查询题允许首项；不是计数丢失。Baseline 有 4 条 Memory 题先查看 Skill。Native 则有 5 条 Skill 题先查 Memory/场景，形成另一方向的工具竞争。

None 的误调用值得后续观察，但现在不能仅凭 10 条负例修改提示词，更不能下结论说 Native 普遍降低了误调用。L3 已回答部分 Memory 题，也可能使模型合理地转向 Coding Skill；所以表中“与标签不符”不一定等于行为本身不合理。后续应先审核工具是否确有必要，再做固定版本、更大样本的比较。

### 固定工具说明成本

从第一题两组实际 Langfuse 输入提取固定 System 工具引导，并加上 Native 新注入的 Schema，使用相同 `cl100k_base` 统计：Baseline **4,073** Token，Native **1,667** Token，减少 **59.07%**。排除动态画像、场景/Skill 目录、问题和结果；不是服务商计费 Token，也不是整个请求缩短 59%。

## 复跑和边界

本次全部结果汇总后，无需再运行 CLI 就可重算：

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
npm run score -- --experiment results/pilot-2026-09-05T18-38-31-734Z
```

下一次新实验使用：

```bash
# 两套服务及凭据需已部署；会新建独立 Agent/Session、提炼并复制数据，再运行 60 次 CLI。
# 此配置会重启两组 Proxy，请避开人工会话。
bash /home/liukuan/Tencent-DB-Memory-Project/eval_kit/run-pipeline.sh \
  /home/liukuan/Tencent-DB-Memory-Project/eval_kit/configs/pilot-30.yaml
```

配置与前置条件见 [一键运行说明](pilot-pipeline.md)。`sample_seed` 固定题目，不固定模型采样或重新提炼的内容。`per_family: all` 当前选择 285 条 Main；15 条 Probe 仍需单列。

尚不能据此冻结正式数据集：

- Memory 正例需要经过首次输入审核，不能把已注入的答案误当成必须搜索的信息。更合适的是另选画像未完整覆盖的具体细节，或将“使用已注入记忆”和“主动查询记忆”分开评测；不要在看到调用结果后改标签。
- Skill 正例主要测试是否使用相关工作方法，未必是不调用就不能完成；Bridge 事件没有业务参数，不能证明查看了正确 Skill 或参考文件。
- 小型资产仍主要来自 15 个模板，Memory 为合成对话；没有验证 40～60 轮长历史，也没有完成全部 300 题的人工业务审核。
- 原 BM25 候选截断、DeepSeek 思考开关是已确认边界。指定会话 Probe 还有导入 ID 与原 Conversation Bridge 的目标会话覆盖问题，本轮未纳入。
- 本轮首次工具即停，不验证完整工具返回、Native 重入、长时 Resume 或 Coding 成功；不能以此证明这些路径没有问题。
- Docker 只挂载当前工作区和本次设置，不可读 dataset/标签/其他结果；但使用 host 网络，不是防恶意任务访问内网的安全沙箱。
- 运行结果含鉴权设置及实验普通用户的密钥，不能公开上传 `keys/` 或完整 `raw/`。

## 逐题结果

符号表示是否符合预先声明的首次选择/不调用标签，不代表 Coding 成败。工具名之间的箭头是 Bridge 到达顺序。所有行观测均有效。

| 编号 | Case | Baseline | Native |
|---|---|---|---|
| 1 | `memory_008_python-fastapi` | ✓ `tdai_read_scene` | ✓ `tdai_memory_search` |
| 2 | `memory_099_memory-proxy-evaluation` | ✓ `tdai_memory_search` | ✓ `tdai_read_scene` |
| 3 | `memory_091_cli-file-processing` | × `skill_view` | ✓ `tdai_memory_search` |
| 4 | `memory_033_redis-concurrency` | × `skill_view` | ✓ `tdai_memory_search` |
| 5 | `memory_003_node-typescript-api` | ✓ `tdai_read_scene` | × `tdai_scenario_ls` |
| 6 | `memory_084_observability-performance` | ✓ `tdai_memory_search` | ✓ `tdai_memory_search` |
| 7 | `memory_027_postgres-migrations` | ✓ `tdai_memory_search` | ✓ `tdai_memory_search` → `tdai_memory_search` |
| 8 | `memory_050_testing-bugfix` | × `skill_view` | × `tdai_scenario_ls` |
| 9 | `memory_017_react-frontend` | ✓ `tdai_read_scene` | × `tdai_scenario_ls` |
| 10 | `memory_081_document-rag` | × `skill_view` | ✓ `tdai_memory_search` |
| 11 | `skill_043_api-auth-security` | ✓ `skill_view` | × `tdai_memory_search` |
| 12 | `skill_003_node-typescript-api` | ✓ `skill_view` | × `tdai_scenario_ls` |
| 13 | `skill_085_observability-performance` | × `tdai_read_scene` | × `tdai_read_scene` |
| 14 | `skill_024_postgres-migrations` | ✓ `skill_view` | ✓ `skill_view` → `skill_view` |
| 15 | `skill_036_message-queue-workers` | ✓ `skill_view` | ✓ `skill_search` |
| 16 | `skill_029_redis-concurrency` | ✓ `skill_view` | ✓ `skill_view` |
| 17 | `skill_088_cli-file-processing` | ✓ `skill_view` | ✓ `skill_view` |
| 18 | `skill_052_testing-bugfix` | ✓ `skill_view` | × `tdai_read_scene` |
| 19 | `skill_008_python-fastapi` | ✓ `skill_view` | ✓ `skill_view` → `tdai_memory_search` |
| 20 | `skill_071_browser-automation` | ✓ `skill_view` | × `tdai_read_scene` |
| 21 | `none_066_browser-automation` | ✓ 无调用，正常结束 | ✓ 无调用，正常结束 |
| 22 | `none_097_memory-proxy-evaluation` | × `skill_view` | × `tdai_memory_search` |
| 23 | `none_052_cicd-release` | ✓ 无调用，正常结束 | ✓ 无调用，正常结束 |
| 24 | `none_036_message-queue-workers` | × `skill_view` | × `skill_view` |
| 25 | `none_039_api-auth-security` | × `tdai_read_scene` | × `tdai_scenario_ls` |
| 26 | `none_047_testing-bugfix` | ✓ 无调用，正常结束 | ✓ 无调用，正常结束 |
| 27 | `none_028_redis-concurrency` | × `skill_view` | × `skill_view` |
| 28 | `none_004_node-typescript-api` | ✓ 无调用，正常结束 | ✓ 无调用，正常结束 |
| 29 | `none_012_python-fastapi` | × `skill_view` | ✓ 无调用，正常结束 |
| 30 | `none_061_docker-linux-ops` | × `skill_view` | ✓ 无调用，正常结束 |

## 最终核对与证据

- 配对数据检查：30/30；每题独立用户、Team、Agent 和 Session。
- 运行后读回核对：60/60，独立 Session 60 个，身份无串用；Bridge 原始记录与统计完全一致。
- Native 客户端结构化调用检查：Native 工具名称及调用 ID 的暴露数为 0。只针对已观察的响应，不扩展成完整链路安全证明。
- 实际输入审核：60/60 均从 Langfuse 读回；30 对 L3 正文、L2 目录和六个候选的最终排列均一致。实际排列不是源 JSONL 随机顺序，不宣称候选顺序随机化已完整实现。工具统计仍只使用 Bridge 事件。
- 原始资产检查：30 份与运行前固定副本逐文件一致；原始工作区未被 CLI 改写。
- 两项目代码的运行前后 HEAD/diff 均一致；本次没有修改 Fake/Native 工具核心，没有重跑旧案例。
- 最终验证：`npm run typecheck` 通过；40 个 Vitest 文件、175 项测试全部通过，无跳过。新增测试先复现了标签泄漏、资源缺失、采样限制、输入格式和日期问题，再确认修正。相关修改的 `git diff --check` 通过。

| 文件 | 用途 |
|---|---|
| `results/preparation/pilot-2026-09-05T18-38-31-734Z/cases.jsonl`、`inputs/` | 当时的固定题目、源对话、Skill 和初始工作区 |
| 同目录 `pair-checks.json`、`builder/*/generation.json` | 两组数据核对、提炼耗时、4096 上限和零调度等待 |
| 同目录 `memory-search-audit.json`、`retrieval-boundary-audit.json` | 实际 Core 查询及 BM25 候选问题复现 |
| 同目录 `asset-source-audit.json`、`source-time-audit.json` | 原始资产核对、源日期问题 |
| `results/pilot-2026-09-05T18-38-31-734Z/summary.json`、`runs/`、`raw/` | 指标、每次运行及原始事件 |
| 同目录 `pipeline-audit.json`、`revisions-after.json` | 会话身份、Native 隐藏及项目版本核对 |
| 同目录 `input-review/`、`input-pair-audit.json`、`static-token-check.json` | 首次注入、两组动态内容和候选排列、thinking 输出及固定说明 Token |

上述运行材料保存在本机，不自动提交或公开其中的凭据。
