# 9 条任务的 Proxy Tool 评测 Pipeline 试跑报告

## 1. 结论与范围

本次采用已完成的 **`pilot-2026-09-05T10-26-56-763Z`**：Memory、Skill、None 各 3 条，两组共 **18 次真实 Claude Code 运行**。不重新抽样、不重新提炼这批初始数据、不重跑失败任务，也不根据结果修改标签。

导入、配对同步、独立身份、隔离运行、Bridge 调用采集、离线汇总及 Viewer 已有实际结果。18 次初始化均绑定预定身份，调用记录均可用于统计。**这不是说 18 次 Coding 都成功**：Baseline 8 次返回最终回答、1 次超时；Native 3 次返回最终回答、6 次后续出错。没有独立代码正确性验收，“返回最终回答”也不等于“代码改对”。

首轮实际按完整任务方式运行。用户随后明确只要求工具观测，套件已增加到观测点停止，并用本地固定响应、真实 CLI 和容器验证。没有把这 18 次旧运行伪装成已经提前停止的新实验。

最新一键入口具备全部步骤，但新版顺序 L1/L2/L3 准备没有再完成整轮 9 对数据：后一次准备在第 4 条的场景文件检查处停止，尚未启动评测 CLI。按用户要求保留进度，不重做整轮。因此不能称为“最新配置的一键命令从头到尾零错误通过”。

## 2. 九条任务 × 两组的实际结果

箭头表示 **Bridge 收到请求的顺序**，不代表并行调用的模型生成顺序。`×2` 是两次独立调用。

| Task | Baseline 实际调用 | Native 实际调用 |
|---|---|---|
| `memory_001_node-typescript-api` | `tdai_scenario_ls → tdai_read_scene` | `tdai_read_scene → tdai_memory_search` |
| `memory_008_python-fastapi` | 无 | `tdai_memory_search` |
| `memory_015_react-frontend` | `tdai_read_scene` | `tdai_scenario_ls → tdai_memory_search → tdai_read_scene` |
| `skill_001_node-typescript-api` | `skill_view → skill_files_read` | `tdai_read_scene → skill_search → skill_view → skill_files_read ×2 → tdai_memory_search` |
| `skill_008_python-fastapi` | `skill_view → tdai_read_scene → skill_files_read ×2` | `skill_view → skill_files_read ×2 → tdai_memory_search → tdai_conversation_search` |
| `skill_015_react-frontend` | `skill_view → skill_files_read → tdai_read_scene` | `skill_view → tdai_scenario_ls` |
| `none_001_node-typescript-api` | 无 | 无 |
| `none_007_python-fastapi` | 无 | 无 |
| `none_013_react-frontend` | 无 | 无 |

后续状态单独保存，不删除上表已发生的调用：

| Task（同上顺序） | Baseline 后续状态 | Native 后续状态 |
|---|---|---|
| Memory 1 | 最终回答 | 首次 503，随后反复 409 |
| Memory 2 | 最终回答 | 502，上游未收到 `message_stop` |
| Memory 3 | 最终回答 | 409，Tool Result 重入未结束 |
| Skill 1 | 600 秒超时；此前已调用 view 和资源读取 | 409，Tool Result 重入未结束 |
| Skill 2 | 最终回答 | 409，Tool Result 重入未结束 |
| Skill 3 | 最终回答 | 503，ClickHouse 执行状态查询错误 |
| None 1/2/3 | 均返回最终回答 | 均返回最终回答 |

结果目录：[`results/pilot-2026-09-05T10-26-56-763Z`](../results/pilot-2026-09-05T10-26-56-763Z)。每次有 `runs/task-XX-variant.json`、CLI 原始 JSONL、Bridge 原始事件及独立工作区。

## 3. Tool Calling 指标

沿用当前数据集标签，不将 `tdai_read_scene` 改判为 `tdai_memory_search`，不为直接 view 的案例补造 search。

| 指标 | Baseline | Native |
|---|---:|---:|
| Memory 正样本发生 Proxy 调用 | 2/3（66.67%） | 3/3（100%） |
| Skill 正样本发生 Proxy 调用 | 3/3（100%） | 3/3（100%） |
| 全部正样本有效调用率 | 5/6（83.33%） | 6/6（100%） |
| None 样本 Memory 误调用率 | 0/3 | 0/3 |
| None 样本 Skill 误调用率 | 0/3 | 0/3 |
| None 样本任意 Proxy Tool 误调用率 | 0/3 | 0/3 |
| Memory 工具选择正确率 | 0/2 | 1/3（33.33%） |
| Skill 工具选择正确率 | 0/3 | 0/3 |
| 总工具选择正确率 | 0/5 | 1/6（16.67%） |

有效调用率按案例计数，不按调用次数计数。分组按样本类别划分，表示这些正样本是否发起任意 Memory/Skill Proxy 调用；具体选得对不对由选择指标判断。本批恰好所有已调用的正样本都调用了其对应类别。

选择分数低有明确标签因素：三个 Memory 标签要求序列恰为 `tdai_memory_search`；三个 Skill 标签要求恰为 `skill_search → skill_view → skill_files_read`。当前 `selectionCorrect()` 对序列标签做完整精确匹配。直接打开已注入目录中的 Skill、先读场景、多读一个参考文件都会判错，**不能解释为 Skill 都不可用**。正式实验前应审核允许首工具/序列，而不是看过结果后只为提高分数调整标签。

六次 Native 错误和一次 Baseline 超时起初被标为不可计分。核对事件和身份后，已改为“工具观测有效、完整任务未完成”。旧判定保存在 `original-run-results-before-tool-metric-review.json`，修正原因在各记录的 `observation_review`；原始 CLI/Bridge 文件未改写。

### 延迟与静态 Token

不比较 Baseline 8 个最终回答与 Native 3 个最终回答的平均延迟；仅有的 3 对完整回答均来自 None，也不能证明 Tool 机制更快。已有时间保留，不将报错或主动停止当作快速完成。本次不再启动额外延迟实验，后续另选依赖已准备好的小任务。

Langfuse 静态工具相关输入：Baseline **4073**，Native **1667**，减少 **59.07%**。包含固定调用引导与 Native Schema，不含 Query、动态 Memory 正文、Skill 目录、结果；统一 `cl100k_base`，不是 DeepSeek 计费 Token。来源和观测 ID 见 `static-token-check.json`。

## 4. 每个阶段实际怎样执行

### 输入、身份和初始数据

按 case_id 排序，在各类别选择三个不同场景、有素材的 main Task，覆盖 Node/TypeScript、Python/FastAPI、React。选择不依赖模型表现。

每个 Task × 版本独立普通用户、Team、Agent、Task，CLI 另建 Session，共 18 套。独立普通用户让 Session Init 只枚举自己的资源，避免共用账号下大量 Team 导致超时。Agent 使用“通用Coding Agent”和“一个通用Coding Agent”，不注入期望工具标签。

保留“一份 Core 提炼结果供两组使用”的公平性设计。首轮九个 Baseline 新 Agent 各导入 40 条 L0，L1 数量依次为 **20、20、20、20、12、20、19、20、20**，均有场景和画像。复制到对应 Native 新 Agent时只换身份，不重新提炼，也不整体替换 Core。

九对正文、记录 ID、时间、全文索引、场景、画像校验一致，API 数量一致；候选 Skill 正文和资源逐文件读回。`pair-checks.json` 保存准备时证据；`unstarted-seed-audit.json` 又核对尚未执行的第 5～9 对，未发现先前任务污染它们。

两组均为原 Standalone 的 **`embedding.provider: none` + BM25**，不是 Native 引入的问题。本次未开启向量检索。真实 Core 查询 FastAPI，两组成功返回相同五个有序 L1 ID且属于目标 Agent，见 `retrieval-check.json`。只证明 BM25 当时可用、配对一致，不证明语义召回质量。

### Claude 运行与 Assets 隔离

CLI **2.1.261**，配置模型 `deepseek-v4-flash[1m]`，实际上游 `deepseek-v4-flash`，两组均为 Anthropic Messages。镜像 `tdai-eval-cli:node22-py312`：Node 22.23.2、Python 3.12.3、pnpm 10.11.0、uv 0.11.28。初期修正过 UID/缓存，实际环境以 `client-environment-final.json` 为准。

真实 LLM、真实 Bridge/Core，不 Mock 业务结果。每次 CLI 只挂载当前素材的可写副本、会话设置和可执行文件，不挂载 dataset 根目录、标签、结果根目录或其他 Task。非 root、只读容器根目录、临时缓存；原素材不交给 Claude 修改。

最新入口另在准备时固定素材副本并保存校验值，再复制给每次 CLI。该增强在首轮之后加入，不能把新版校验文件说成首轮已经有。测试覆盖不同任务、两组、重复运行对同一素材的修改互不影响。

### 埋点与结果核对

两组在 Memory/Skill Bridge 入口记录同类事件：事件 ID、Session、工具名、类别、时间、可用时的 call_id。**Tool Call 主采集不依赖 Langfuse**，Langfuse 仅用于静态 Token 和定向排错。

每次前后检查观测服务健康及进程标识，结束后查 Session Init 是否关联预定 Agent。Native 同 call_id 的内部重试去重；Baseline 没有可靠 call_id，不按名字猜测。同名多次调用保留。

独立读回审核：18 个独立 Session、18 个独立版本内用户、18 次正确初始化；原始事件与统计相符，客户端结构化 Tool Call 中未发现 Native 工具名/Native call_id。这不等于模型自然语言永远不会提到工具名。

## 5. 到观测点停止，不再等待 Coding

最新一键入口默认 `measurement: tool_calls`：

- 普通案例首次收到任意 Memory/Skill Bridge 事件即停止；错误类别也记录，不等模型“改对”才计数。
- 示例的三个 Skill 案例在收到 `skill_view` 和 `skill_files_read` 后停止，此前调用全部保留。
- 没调用时等正常最终回答；超时/API 失败且无调用属于无效，不能算正常负样本。
- 已有可靠调用、后来 Coding 报错，保留统计和错误。主动停止不算超时、不生成端到端延迟。

每 250 毫秒检查当前 Session 事件，满足条件后结束 CLI、移除容器。原始事件保留，统计截至停止时刻。这是**观察到调用后停止**，不是 Mock 返回业务数据。

自动化集成检查用本地测试响应、真实 CLI/容器：正常回答成功；Bash 发起 view/资源请求后在数秒内停止，不继续等 60 秒睡眠。这些模拟请求不属于九条业务样本，不计入分数。

边界：入口只证明发起；工具名不能证明“正确 Skill/正确文件”或后端成功。需要时可从 CLI、Langfuse 或 Native Ledger 定向核对参数/结果，本轮不新增参数埋点。停止客户端也不保证已开始的服务端后台操作立即取消；独立 Agent 防止它影响其他案例。

## 6. Bug、原因和修复情况

| 问题 | 原因及处理 | 状态 |
|---|---|---|
| Skill 资源缺失 | 旧导入器只读 `files/`；增加标准资源目录，读回逐文件核对 | 已修复、测试 |
| CLI 只能 curl | 权限不适合 Coding；两组统一权限并隔离运行 | 已修复、实跑 |
| 多 Agent 提炼进度混用 | Core 按 Session 维护进度；导入时使用实验/Task 唯一 Session | 已修复、实跑 |
| 宿主 Bash 可读取种子/标签 | 早期工作区在 results 下；该次作废，改限定挂载容器 | 已修复；作废数据不混入 18 次 |
| 初始化超时后仍返回无工具回答 | 共用账号 Team 太多；独立普通用户并核对初始化身份 | 已修复、18 次核对 |
| 服务 active 但 HTTP 未就绪 | 增加有截止时间的 HTTP 检查 | 已修复、测试 |
| Baseline Core 版本保护阻止启动 | 观测补丁许可只在 Proxy unit；Core 加相同精确 diff 校验值，未关闭保护 | 环境已修复 |
| 镜像构建/npm 链接/缓存失败 | 使用网络代理、保留符号链接、匹配 UID/GID 和缓存目录，执行前探测 | 已修复、实跑 |
| 队列空闲不代表 Memory 完成 | L2 延迟且模型可能不写文件；检查实际 L0/L1 数量和场景/画像 | 检查已修复；模型失败保留 |
| 快速准备只处理前 10/40 条 | 新准备器忽略 `hasFullBacklog`；与 `hasMore` 一起处理，排空 L1 后才 L2 | 已修复、测试及真实准备验证 |
| 导入时间游标可能相同 | 给 `recordedAt` 分配严格递增值 | 已处理、40 条完整核对 |
| Coding 超时抹掉调用 | 分开观测有效性和最终回答，保存旧判定及修正原因 | 已修复、18 次离线重算 |
| Viewer 不认识新字段/未完成观测 | 更新结果 Schema、状态和说明 | 已修复、测试 |
| Langfuse 输入格式不一致 | 同时支持 Baseline 消息数组和 Native 请求对象 | 已修复、真实 Token 核对 |
| 报告把观测有效称为完成 | 分列工具观测和 CLI 状态 | 已修正文案 |

### 快速准备及预算：保留实际过程

Core 提炼通过 `generateText()` 等待完整结果，不是客户端 SSE。旧路径 40 条 L0 约 2 分 46 秒：四次 L1 约 82 秒、L2 约 35 秒、L3 约 18 秒，以及约 30 秒实际空等。Core 的 L2 配置延迟 90 秒，评测的 95 秒空闲观察用于防止过早复制，并非再串行睡 95 秒。

早期排查曾将两组在线 Core 的 4096 提到 **16384**；首轮初始数据确实在该配置下准备，不能事后改称一直 4096。收到用户约束后已恢复在线两组为 **4096**，最终准备器只允许 4096/8192。16384 是本次过程中的环境调整，不是今后默认配置。

新版仅在独立进程/目录复用 Baseline Core 原有函数：L0 → 排空全部 L1 → L2 → L3 → 校验 → 复制两组。不启动在线调度器，不修改生产 90 秒规则，不增加生产“立即提炼”接口。

独立验证中，开启思考的 4096 和 8192 都出现过截断；准备进程明确设置 DeepSeek `thinking: disabled` 后，三个场景在 4096 下分别约 **49.0、44.1、41.3 秒**生成完整数据，人工等待为 0。使用真实模型，不是 Mock；这些只验证准备过程，不属于业务评测样本。

后一次 `pilot-2026-09-05T11-38-52-201Z` 核对了前 3 对，第 4 条 L2 却约 0.9 秒返回 7 字符、`finishReason=stop`，没有写文件，L3 因无场景不执行。这次**不是截断**，扩大预算不是有证据的修复。准备器正确停止、未分发第 4 条半成品、未开始评测 CLI。按用户要求不重做已完成内容，不加自动重试/恢复状态机；目录保留且不计入 18 次统计。

## 7. 未修复的 Native 核心问题

### 纯 Client 后续轮误写 Native Ledger

会话 `7b2bf3c6-554f-4abf-8818-c27659f2543e`，第 2 轮只有已完成的 Client Bash，call_id `call_00_Tvc7rd84aC07DTncfc6D5363`。实际是 Native Memory 成功 → Bash → Claude 回填 → 首次 503 → 反复 409。

`client-tool-resume.ts` 取得重入执行权后，只要存在 ledgerStorage 就调用 `buildNativeToolLedgerRound(context)`；`tool-ledger-round.ts` 要求至少一个 Native 调用，纯 Client 轮抛出 `Native Tool ledger requires a Native Tool call`。执行权尚未到期，重试又被拒绝。

已用当前源码和持久化记录最小结构复现，证据 `native-client-only-ledger-repro.json`。Memory 3、Skill 1/2 也出现 409，但不能仅凭相同 HTTP 码确认所有根因相同。本次不改逻辑、不关闭 Ledger 绕过。

### 上游 SSE 不完整

会话 `0c8f413c-ce3d-49a9-9318-0d59061baefd`：Memory 调用后 `502 Anthropic upstream stream ended before message_stop`。重入结果保存了错误，后续重试继续收到它。缺少完整上游字节，暂不能区分 DeepSeek、网络还是解析器责任；只确认表现及错误复用，保留原始 CLI 和会话标识。

### ClickHouse 执行状态查询错误

会话 `b88a39e9-beba-4a83-94c6-3396e31babea`：Skill 3 已调用 view/场景列表，随后 503。Proxy 日志及真实 `system.query_log` 都显示：

```text
NOT_FOUND_COLUMN_IN_BLOCK (code 10)
Not found column _block_number in block
MergeTreeSelect(pool: ReadPoolInOrder, algorithm: InOrder)
ClickHouse 25.12.11.4
```

查询 ID `a2c78919-bc69-4d4d-8b9a-520cf78907db`，对 `native_proxy_tool_execution_state` 按 Session/call_id 检索并 `ORDER BY updated_at DESC LIMIT 1`。完整查询及错误保存在 `native-task06-clickhouse-error.json`。这是存储查询错误，不是第一类 Ledger 条件异常；数据库内部具体原因尚未定位，本次不改表或查询绕过。

## 8. 关闭思考模式的实际状态

后续 CLI 已配置 `MAX_THINKING_TOKENS=0`、`alwaysThinkingEnabled: false`：全局 `/home/liukuan/.claude/settings.json`、实验目录两组 `claude-config/settings.json`、人工脚本 `bin/claude-baseline`/`claude-native`，以及 eval_kit 的 client/container 入口。原 Hooks 和身份配置不变。

**CLI 设置不等于上游一定生效。**真实 Claude Code 2.1.261 使用 `deepseek-v4-flash[1m]` 时，本地捕获发现请求省略 `thinking`，未发送 `{"type":"disabled"}`。不能保证 DeepSeek 默认思考也已关闭。声明自定义模型能力未改善结果，未保留无效配置；未改 Proxy 核心或悄悄换模型名。

准备进程直接为 Chat Completions 设置 `thinking.type=disabled`，已通过请求体测试及真实提炼验证。首轮 18 次仍是当时配置，不能改称非思考实验。下一轮若要求严格非思考，应先单独解决 CLI 自定义模型请求编码并核对上游。参见[Claude Code 配置](https://code.claude.com/docs/en/model-config)与[DeepSeek 思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)。

## 9. 其他边界与风险

- 标签/Query/素材仍需审核：README 含评测快照标签；Memory 信息可能已在画像或 TASK_CONTEXT；三个 None 要重命名的 `data` 在素材中不存在。本次不为提高分数修改。
- Bridge 看不到校验前失败/错误 curl 地址；事件无参数结果，不能计算参数正确率或执行成功率。
- 完整序列评分受窗口影响：首次调用后停止不适合验证更长序列，未来应提前选择首工具指标或匹配的多步停止条件。
- 首轮完整窗口与今后早停窗口不能混为正式 A/B 结果；后台处理可能在 CLI 停止后继续，不把停止时间称为端到端延迟。
- 容器用 host 网络连接实验服务，隔离文件但不是恶意素材网络沙箱。只在专用机器使用可信数据集。
- 准备器适配本机 SQLite/本地画像，不自动安装全套服务、不支持远程迁移；模型不写文件时明确失败，不能保证任意数据一次成功。
- 未来重新提炼存在随机性，保存 seed_version；失败和未使用身份保留排错，不自动删除，不复用已运行 Agent。

## 10. 交付和验证

完整配置见 [一键运行说明](pilot-pipeline.md)。

```bash
# 今后开启新一轮：检查、导入/提炼/同步、两组运行、观测、汇总
bash /home/liukuan/Tencent-DB-Memory-Project/eval_kit/run-pipeline.sh \
  /home/liukuan/Tencent-DB-Memory-Project/eval_kit/configs/pilot.example.yaml

# 本次只重算现有结果：不创建 Agent、不请求模型、不重跑
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
npm run score -- --experiment results/pilot-2026-09-05T10-26-56-763Z
```

修改限于 eval_kit、文档和实验环境；两项目已有观测补丁 HEAD/diff 与开始一致，未改工具核心。精确版本见 `revisions-after.json`；最终 TypeScript、Vitest、18 次离线审核及 CLI/容器检查结果见 `pipeline-final-review.json`。本次没有额外 commit 或推送。
