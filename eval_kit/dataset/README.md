# Eval Kit 数据目录

这个目录只保存评测需要的数据，不保存密钥、运行日志或 MemoryCore 数据库。

```text
dataset/
├── assets/                  # 每条任务需要读取的项目、文件或其他输入
├── memories/                # 正式评测使用的 L0 对话
├── skills/                  # 正式导入并参与评测的 Skill
├── tasks/                   # 问题、预期工具和判断条件
├── review/                  # 审核说明及事实补充来源，不向 Claude Code 提供
└── template4AI/             # 提供给 AI 的模板和例子，不作为正式数据
    ├── memories/
    └── skills/
```

## 正式评测数据

- `tasks/tool_call_eval_v1.jsonl` 保存当前修订数据。文件名保留以免破坏现有配置，不代表内容仍是 v1。
- `skills/` 中每个 Skill 使用独立目录，并以 `SKILL.md` 为入口。`browser-use` 和 `docling-document-intelligence` 当前属于正式评测 Skill。
- `memories/` 只保存导入前的 L0 对话。一键 Pipeline 将生成的 L1/L2/L3 保存在 `results/preparation/<实验>/builder/`，每题提炼一次后复制给两组。
- `assets/` 按 `case_id` 建立子目录。Pipeline 先保存素材副本，Runner 再为每次运行复制一份；Claude Code 只看到容器中的 `/workspace`，看不到带类别的来源目录名。

## 2026-09-05 修订

当前仍为 300 题：Memory / Skill / None 各 100。Main 共 285 题，另有 15 条 Memory Probe，不混入主指标。完整修改及剩余限制见 [修订说明](review/v2-revision.md)。

- 工作区内移除了类别编号和不必要的评测提示。
- Main 正例改为 `allowed_first_tools`。首次 Bridge 调用后停止，与首次选择评分一致；`expected_skills` / `expected_skill_files` 仍是审核信息，不是当前 Bridge 指标已经验证的能力。
- Memory 为 15 个会话，每会话 20 轮，共 300 轮 / 600 条消息。原来的 90 条核心决定保留，编号填充替换成 210 条有实际含义的项目记录。源 `session_id` 和文件名保留历史标识；其中的 `40-rounds` / `60-rounds` 不再表示当前长度，以 `messages` 为准。
- 30 题配置为 `configs/pilot-30.yaml`：固定 seed，每类 10 题。`per_family: all` 运行所有 Main；不是把 300 题及 Probe 混成一个集合。

## 提供给 AI 的参考材料

`template4AI/` 中保存 Skill 和 Memory 模板，以及原先的 3 个 Skill、50/100/200 轮对话例子。模板中的 `{{...}}` 是待替换内容，不应直接导入。

当前 `configs/data-preparation.yaml` 暂时使用这里的 Memory 例子来检查数据准备程序，因此数据版本名称带有 `example`。生成正式 L0 后，应同时把 `memoryDataset` 改为 `../dataset/memories`，并修改 `datasetName`。

检查参考 Skill：

```bash
cd /home/liukuan/Tencent-DB-Memory-Project/eval_kit

npm run skills:import -- \
  --variant both \
  --directory ./dataset/template4AI/skills/examples \
  --user-id USER_ID \
  --team-id TEAM_ID \
  --agent-id AGENT_ID \
  --dry-run
```

检查参考 L0：

```bash
npm run memories:import -- \
  --variant both \
  --directory ./dataset/template4AI/memories/examples \
  --user-id USER_ID \
  --team-id TEAM_ID \
  --agent-id AGENT_ID \
  --dry-run
```

Memory 数据中的一轮是连续的一条 `user` 消息和一条 `assistant` 消息。导入程序会把较大的会话拆成每批不超过 100 条消息的请求，同时保留原 `session_id` 和消息顺序。
