# Eval Kit 数据准备

数据准备功能属于 Eval Kit，不复制第三份业务源码。它复用 Baseline 的 MemoryCore 和 Memory Hub；Skill 与 L0 只导入一次，L1/L2/L3 也只生成一次。处理完成后，同一份 Core 数据会分别恢复到 Baseline 和 Native，避免两边各自调用 LLM 后得到不同记忆。

## 1. 修改配置

编辑 [`../configs/data-preparation.yaml`](../configs/data-preparation.yaml)，通常只需确认四个路径和导入身份：

```yaml
paths:
  baselineProject: ../../TencentDB-Agent-Memory-Baseline
  nativeProject: ../../TencentDB-Agent-Memory-Native
  skillDataset: ../dataset/skills
  memoryDataset: ../dataset/template4AI/memories/examples
```

相对路径以 `configs/data-preparation.yaml` 所在目录为起点。`initialCoreData` 必须指向一份干净的 MemoryCore 初始数据。配置中不保存 API Key；工具从现有 Baseline 运行目录复制凭据，并把副本权限设为 `0600`。

上面的 `memoryDataset` 暂时指向原有示例，以便直接检查导入流程。正式评测数据准备好后，应将它改为 `../dataset/memories`。正式 Skill 位于 `../dataset/skills`，供 AI 仿写的 Skill 示例不会被导入。

## 2. 先做只读检查

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit
./prepare-data.sh --check
```

这条命令会检查项目版本、MemoryCore 源码、数据格式、重复的 Skill 名称和会话 ID，并计算本次数据版本号；不会启动或停止服务，也不会导入、替换任何数据。

## 3. 一键准备并安装

```bash
./prepare-data.sh
```

命令会依次完成：

1. 从干净的 Core 数据启动独立构建环境；
2. 导入配置中的全部 Skill 和 L0；
3. 等待 L1、L2、L3 处理结束；
4. 停止独立 Core，保存一份完整底稿；
5. 将同一底稿安装到 Baseline 和 Native；
6. 检查两边的 L0 数量、Skill 名称和后台处理状态。

注意：安装的是完整 `data/core`，不是只把当前 Agent 的几条记录合并进去。因此 Baseline
和 Native 应当是专门用于评测的干净环境；原有完整 Core 数据会先移入备份目录。

如果 Skill、Memory、初始数据、身份、MemoryCore 源码和运行配置都没有变化，再次执行会直接复用已有底稿，不会再次导入或调用 LLM。

## 4. 查看处理进度

命令运行期间会在终端显示 L1、L2、L3 的等待和运行数量。独立 Memory Hub 会保持运行：

- 本机服务器访问：`http://127.0.0.1:25173`
- 后端接口：`http://127.0.0.1:28124`

在 Windows PowerShell 中建立端口转发：

```powershell
# 将 <server> 换成服务器 IP 或 SSH 主机名；窗口需要保持运行
ssh -N `
  -L 25173:127.0.0.1:25173 `
  -L 5173:127.0.0.1:5173 `
  -L 15173:127.0.0.1:15173 `
  -L 3000:127.0.0.1:3000 `
  liukuan@<server>
```

随后可在 Windows 浏览器打开：

- 数据构建环境 Memory Hub：`http://127.0.0.1:25173`
- Baseline Memory Hub：`http://127.0.0.1:5173`
- Native Memory Hub：`http://127.0.0.1:15173`
- Langfuse：`http://127.0.0.1:3000`

## 数据与备份位置

```text
<labRoot>/data-builder/data/core/          当前构建环境数据
<labRoot>/data-builder/releases/           按输入内容保存的完整底稿
<labRoot>/data-builder/backups/            构建环境旧数据
<labRoot>/run/data-builder-backups/         Baseline/Native 替换前的数据
```

目标安装采用“先复制、再停服改名”的方式。任一侧安装或自动检查失败时，会尝试恢复两边的原数据；旧数据不会直接删除。

L1/L2/L3 是否生成非空内容由 MemoryCore 和抽取模型决定。工具判断的是后台处理已经结束，
不会把“某一层没有新增内容”误报成程序故障；最终生成的全部文件和数据库都会随底稿一起复制。

## 评测时的注意事项

只测查询和召回时，应关闭或避免触发新的记忆写入。若用例本身会新增 L0 或触发新的记忆处理，每组 Baseline/Native 对比前都应重新执行 `./prepare-data.sh` 恢复同一底稿，避免上一条用例改变下一条用例的起始数据。

如需查看服务日志：

```bash
tail -f /storage1/liukuan/tencentdb-memory-lab/data-builder/logs/*.log
```
