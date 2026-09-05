# 一键运行 Memory / Skill / None 小样本评测

## 一条命令

先编辑 [`configs/pilot.example.yaml`](../configs/pilot.example.yaml)，随后可在任意目录运行：

```bash
# 新建独立实验：各类 3 条、两组共 18 次，自动准备数据、执行、记录和汇总
bash /home/liukuan/Tencent-DB-Memory-Project/eval_kit/run-pipeline.sh \
  /home/liukuan/Tencent-DB-Memory-Project/eval_kit/configs/pilot.example.yaml
```

已完成实验不需要再次执行此命令。只重算指标：

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
npm run score -- --experiment results/pilot-2026-09-05T10-26-56-763Z
```

脚本不隐式复用已运行 Agent，不覆盖已有实验，不自动重跑失败案例。数据准备失败或观测无效时保存记录并返回非 0；工具已记录而后续 Coding 失败，在 `tool_calls` 模式不因此否定工具指标。`end_to_end` 模式则要求完整最终回答，失败返回非 0。

## 必要环境

- Linux、Node.js 22（含 `node:sqlite`）、eval_kit 依赖、Claude Code CLI、uv、Docker。
- 两套已经部署的 Core/Proxy，Native ClickHouse 等依赖可用；两组 Bridge 观测已启用。脚本不负责首次安装整套 TencentDB Agent Memory。
- 当前第一版使用本地布局：`lab_root/{baseline,native}/data/core/instances/<service_id>/vectors.db`，画像位于 `data/core/profiles`，Proxy 状态在 `data/proxy/proxy.db`。
- 每组 `secrets/` 已有 `core-gateway.key`、`admin-user.key`、`core.env`、`claude.env`。静态 Token 的 Langfuse 配置来自 `secrets/proxy.yaml`。密钥不填进示例 YAML、不提交 Git。
- 每组 `run/tool-observations/observer.json` 及 Session JSONL 对应当前 Proxy 进程。`start_services: true` 只启动已安装的 `tdam-{baseline,native}-{core,proxy}` 用户服务；外部管理服务设 false。
- 本轮固定两组原 Standalone **BM25、embedding=none**。配置不一致会报错，不自动装 embedding 或切换召回方式。

## 主要配置

配置内相对路径按 YAML 所在目录解析。

| 配置 | 用途 |
|---|---|
| `variants.baseline.project` / `variants.native.project` | 两项目根目录，不是 MemoryProxy 子目录 |
| 每组 `core_url` / `proxy_url` | Core API 地址和 Claude Code 接入地址 |
| `lab_root` / `service_id` | 当前本地服务数据与凭据布局 |
| `dataset` / `asset_base` | Task JSONL 及其 `asset_path` 的解析根目录 |
| `skills` / `memories` | 候选 Skill 包、原始对话目录 |
| `results_dir` | 准备记录和运行结果位置 |
| `claude_binary` / `uv_binary` | 本机可执行文件路径 |
| `model` / `client_image` | 两组共用模型配置和隔离镜像 |
| `per_family` | 各类数量，默认 3；`all` 选择全部 Main，不含 Probe |
| `sample_seed` | 固定抽样种子；先覆盖不同场景，再选择同场景后续任务；输入行重排不影响抽样 |
| `restart_proxies` | 默认 false；专用评测示例设 true，在准备前重启两组 Proxy，防止旧进程继续运行旧源码。会中断现有人工会话 |
| `measurement` | 默认 `tool_calls`；小任务完整延迟另用 `end_to_end` |
| `stop_after_tools` | 指定案例需要观测到的工具名；未填写则第一条任意 Proxy 调用即停止 |
| `timeout_ms` | 运行总上限，示例 600000；不是每个案例都等这么久 |
| `preparation_max_tokens` | 准备进程 4096，确有截断时显式选 8192；拒绝 16384 |
| `preparation_thinking` | 示例 `disabled`，只影响独立准备进程的 DeepSeek 请求 |
| `processing_timeout_ms` | 每个准备进程总截止时间，示例 1800000 |
| `allow_bash` | 两组是否允许真实 Coding 命令；示例 true，并在隔离容器中执行 |

当前示例和 `pilot-30.yaml` 均在第一条任意 Proxy 调用后停止，与 Main 的首次选择标签一致。这不是参数正确性 Judge，也不证明后端已经成功读取目标内容。只有专门检查完整步骤的案例才配置 `stop_after_tools`，并使用相应的顺序标签。

修订数据的 30 题检查：`bash run-pipeline.sh configs/pilot-30.yaml`。该配置每类 10 题，固定 `sample_seed: pilot-30-20260905`，运行上限 180 秒；不要将“无调用且超时”当作正常负例。

## 自动流程

1. 校验引用、服务、认证、观测目录，记录两项目 HEAD/diff，检查真实客户端镜像。
2. 每个 Task × 版本新建普通用户、Team、Agent、Task。Agent 使用“通用Coding Agent”和“一个通用Coding Agent”；每个导入 Session 也独立。
3. 导入相同候选 Skill，含正文与 `references/`、`scripts/`、`assets/`、旧 `files/`；逐个读回核对。
4. 在独立进程/目录复用 Baseline Core 原有函数：L0 → 全部 L1 → L2 → L3。不启动在线调度器、不修改生产等待规则，没有固定 90/95 秒空等。
5. 检查实际记录和场景/画像，把唯一一份结果复制到两组空 Agent，核对正文、索引、文件和 API 数量。不整体替换 Core，不重复提炼两次。
6. 固定 Task 的初始项目副本和校验值，每次运行再复制成自己的可写 Workspace；两组交替先运行，不共用已修改文件或缓存。
7. 真正启动 CLI。Native 保留官方 Hooks；独立 Session、设置、鉴权；只挂载当前素材、设置和 CLI，不挂载 dataset/标签/结果根目录。
8. 按指定点停止或等最终回答，保存 Bridge/CLI 原始记录，核对身份、事件归属及客户端 Native Tool 是否隐藏，再汇总指标和静态 Token。
9. 单独读回首次实际模型输入中的动态 Memory 与候选 Skill 顺序，保存到 `input-review/`。逐字命中只作审核线索；摘要中换一种说法给出答案仍需人工判断，程序不自动重写标签。

工具模式主动结束时，`stopped_on_observation=true`、`completed=false`、`end_to_end_ms=null`。后续 Coding 失败但已有可靠调用时，`observation_valid=true`，错误另外保存。没有调用且 API 失败/超时则无效，不计作正常 None。

### 公平性与隔离

同一 Task 两组共享同一初始 Memory、Skill 和素材内容，但不共用 Agent/Session；不同 Task、重复实验均不共用 Agent。原始素材只用于复制，Claude 改动的是单次运行副本。下次实验重新提炼可能产生不同内容，准备记录中的版本需保留。

容器非 root、只读根目录、临时缓存。镜像缺失时自动构建，存在则实际检查；构建时间不计入延迟。使用 host 网络访问本机服务，因此不是恶意素材网络安全沙箱，仅适合专用机器与可信数据。

### 准备失败怎么办

真实 LLM 可能返回正常结束但不写场景文件。脚本会保存 `failure.json`/日志并停止，不把半成品发给两组。先查看 `builder/task-XX/extraction.log`：只有 `finishReason=length` 才有依据将**准备进程**预算改为 8192；“stop 但无写文件”不能直接归因于预算。

本版不增加复杂断点恢复或自动重试。不要重新运行已完成的 9 条任务只为得到零退出码；现有实验用 `score` 重算，未完成准备保留排查。当前新版准备第 4 条失败的实际情况见[试跑报告](pilot-9-task-report.md)。

## 思考模式设置

评测 CLI 固定传 `MAX_THINKING_TOKENS=0`，隔离设置写 `alwaysThinkingEnabled: false`；人工启动脚本和对应设置文件也已配置。一般命令为：

```bash
# 临时关闭 CLI 思考设置后启动；现有实验启动脚本已包含这一项
MAX_THINKING_TOKENS=0 claude
```

注意本机 CLI 2.1.261 使用 DeepSeek 自定义模型名时，实测可能省略 HTTP 的 `thinking` 字段，所以不能保证上游也关闭。准备进程则直接发 `thinking.type=disabled`，两者不同。这个兼容性边界尚未修复，不把旧实验改称非思考实验。

## 输出与查看

```text
results/
├── preparation/pilot-<UTC>/
│   ├── pipeline-config.json / revisions-before.json
│   ├── cases.jsonl / manifest.pending.json / manifest.json
│   ├── keys/                         # 每个 Task 的密钥，禁止公开
│   ├── inputs/task-XX/                # Skill、对话、固定项目副本
│   ├── builder/task-XX/               # Core 产物、逐阶段耗时和日志
│   ├── pair-checks.json / imports.json
│   ├── observation-config.json / ready.json
│   └── failure.json                  # 失败时保留
└── pilot-<UTC>/
    ├── report.md / summary.json / manifest.json
    ├── data-preparation.json / revisions-after.json
    ├── pipeline-audit.json / static-token-check.json
    ├── input-review/                # 首次输入的 Memory、候选顺序和目标事实，供标签审核
    ├── runs/task-XX-<variant>.json
    └── raw/task-XX-<variant>/         # CLI、Bridge、设置、可写项目
```

Viewer 在服务器本机 `http://127.0.0.1:4173`：

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
npm run viewer -- --results results --port 4173
```

```powershell
# Windows：替换 SSH_HOST 为实际服务器地址或 SSH 别名，保持窗口开启
ssh -N -L 4173:127.0.0.1:4173 SSH_HOST
```

Windows 浏览器访问 `http://127.0.0.1:4173`。不要公开上传 keys/ 或 raw/，其中包含本次普通用户的鉴权配置。

## 验证命令

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
npm run typecheck
npm test

# 可选：真实 CLI/容器接本地固定测试响应，只测配置与停止，不消费 DeepSeek Token
CLAUDE_BINARY=/absolute/path/to/claude.exe EVAL_CLIENT_IMAGE=tdai-eval-cli:node22-py312 \
  node --import tsx tests/claude-container-smoke.ts /absolute/path/to/smoke-result.json
```

该本地检查的 `passed` 表示进程生命周期通过；思考请求必须另看 `explicit_thinking_disabled_on_all_requests`，不能混为一谈。
