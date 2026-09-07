# TencentDB Agent Memory Data Builder 设计

## 目标

提供一套独立的数据准备环境。使用者只修改一个 YAML 配置文件并执行一个命令，即可完成：

1. 检查 Baseline、Native、Skill 数据集和 Memory 数据集；
2. 在 Data Builder 中导入一次 Skill 和 L0；
3. 等待 L1、L2、L3 处理结束；
4. 保存完整的 MemoryCore 数据版本；
5. 将同一份结果安装到 Baseline 和 Native；
6. 校验两边的 L0、Skill 及完整数据版本来源一致。

这样可以避免 Baseline 和 Native 分别调用 LLM 后产生不同的 L1、L2、L3。

## 使用方式

数据准备功能位于 `eval_kit`，默认入口为：

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
./prepare-data.sh
```

`prepare-data.sh` 默认读取 `configs/data-preparation.yaml`。只检查配置、不改动服务和数据时使用：

```bash
./prepare-data.sh --check
```

## 配置

配置文件保留使用者真正需要修改的内容：

```yaml
version: 1

datasetName: proxy-tool-eval-v1

paths:
  baselineProject: ../../TencentDB-Agent-Memory-Baseline
  nativeProject: ../../TencentDB-Agent-Memory-Native
  skillDataset: ../dataset/skills
  memoryDataset: ../dataset/template4AI/memories/examples
  labRoot: /storage1/liukuan/tencentdb-memory-lab
  initialCoreData: /storage1/liukuan/tencentdb-memory-lab/seed/core

identity:
  serviceId: rhino-ab
  userId: usr-f7iwo2muhb
  teamId: team-f7jadamhk3
  agentId: agt-f7jq1rrl7h

builder:
  corePort: 28420
  panelPort: 28124
  webPort: 25173

targets:
  baselineCorePort: 8420
  nativeCorePort: 18420

processing:
  timeoutMinutes: 120
  l2WaitSeconds: 95
  pollIntervalMs: 1000
  idleConfirmations: 3
```

相对路径以配置文件所在目录为起点。凭据不写入配置文件；Data Builder 从 `labRoot/baseline/secrets` 复制当前环境已经使用的凭据，并把副本保存为 `0600`。

## 目录与服务

Data Builder 复用配置中 Baseline 项目的 MemoryCore 和 MemoryPanel 源码，不维护第三份业务代码。运行数据放在：

```text
<labRoot>/data-builder/
├── config/
├── secrets/
├── data/core/
├── logs/
├── releases/<数据集名称>-<输入摘要>/core/
└── backups/
```

运行时安装三个 user systemd 服务：

- `tdam-data-builder-core.service`；
- `tdam-data-builder-panel.service`；
- `tdam-data-builder-web.service`。

Memory Hub 地址为 `http://127.0.0.1:25173`。它只用于查看 Memory 和 Skill，不启动 MemoryProxy 和 Knowledge。

## 处理过程

### 检查阶段

正式写入前一次性检查：

- 两个项目目录及其 `MemoryCore`、`MemoryPanel` 存在；
- 两边 MemoryCore 包版本一致；
- Skill 数据能够被现有 `discoverSkillPackages()` 完整读取；
- Memory 数据能够被现有 `discoverMemorySessions()` 完整读取；
- 数据集中 Skill 名称和会话 ID 没有重复；
- 初始 Core 数据和 Baseline 凭据存在；
- Baseline 与 Native 的 MemoryCore 源码树相同，并且两边的 `MemoryCore` 没有未提交修改。

任何一项失败都在改动服务前结束。

### 构建阶段

输入摘要由以下内容计算：

- Skill 数据集所有有效文件的路径和内容；
- Memory 数据集所有 JSON/JSONL 的路径和内容；
- 初始 Core 数据；
- 身份配置；
- 两边共同的 MemoryCore Git tree；
- Baseline 当前 MemoryCore 运行配置（凭据字段不写入 manifest）。

如果相同摘要的完整数据版本已经存在，直接复用，不再调用 LLM。否则执行：

1. 停止 Data Builder；
2. 将旧 Data Builder 数据移入带时间的备份目录；
3. 从 `initialCoreData` 复制一份干净数据；
4. 生成配置和 systemd 服务并启动 Data Builder；
5. 调用现有 Skill 导入函数；
6. 调用现有 L0 导入函数；
7. 等待 L1 队列清空，再覆盖 L2 延迟窗口，最后等待 L2/L3 连续多次为空；
8. 停止 Data Builder，使 SQLite 完整关闭；
9. 将 `data/core` 保存到不可原地覆盖的数据版本目录，并写入 manifest；
10. 重新启动 Data Builder，保留 Memory Hub 查看入口。

处理结束以 `/v2/pipeline/status` 为准，不以 Memory Hub 数字是否继续增加为准。L3 可能判断无须生成新内容，因此“数量没有增加”不等于失败。

## 安装到 Baseline 和 Native

安装前停止两套环境中会访问 MemoryCore 的服务。每个目标按以下方式替换：

1. 先把新数据复制到目标目录旁的临时目录；
2. 把旧 `data/core` 移入 `<labRoot>/run/data-builder-backups/<时间>/<环境>/core`；
3. 原子改名启用新数据；
4. 两边都成功后重新启动服务；
5. 任一步失败则移走未完成的新目录并恢复旧目录。

Native 中已有 Knowledge 资产引用的端口会从 Baseline 端口改为 Native 端口；该改动不改变 Memory 和 Skill 内容。数据版本 manifest 同时记录输入摘要和 Data Builder 完整文件清单，Baseline/Native 记录同一个数据版本 ID。

## 校验

自动校验包括：

- 每个输入会话在 Data Builder、Baseline、Native 中的 L0 数量等于输入数量；
- 三边都包含输入数据集中的 Skill；
- Data Builder 完成 L1/L2/L3 后才保存底稿，三边最终均无等待或运行中的处理任务；
- 两边安装记录引用同一个数据版本 ID 和输入摘要；
- 三套 `/v2/pipeline/status` 最终均无等待或运行中的任务。

不能用整个目录的字节哈希直接比较 Baseline 与 Native，因为 Native 需要改写环境专属的 Knowledge 服务地址；Memory、Skill 和数据版本来源单独校验。

## 失败处理

- 数据集或配置错误：不启动构建、不修改目标数据；
- Data Builder 导入或 LLM 处理失败：保留日志和构建数据，目标环境不变；
- 保存数据版本失败：目标环境不变；
- 目标安装失败：恢复两边原数据并重新启动原服务；
- 超时：报出仍在处理的层级和会话，不把半成品安装到目标环境。

所有被替换的数据均保留在备份目录，不执行不可恢复删除。

## 评测期间的使用约束

查询和召回类 A/B 测试应从同一数据版本开始。若测试本身会写入 L0 或触发新的记忆处理，应在每组可比测试前重新安装该数据版本，避免前一个用例改变后一个用例的初始数据。
