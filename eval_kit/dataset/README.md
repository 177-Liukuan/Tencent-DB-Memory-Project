# Eval Kit 数据目录

这个目录只保存评测需要的数据，不保存密钥、运行日志或 MemoryCore 数据库。

```text
dataset/
├── assets/                  # 每条任务需要读取的项目、文件或其他输入
├── memories/                # 正式评测使用的 L0 对话
├── skills/                  # 正式导入并参与评测的 Skill
├── tasks/                   # 问题、预期工具和判断条件
└── template4AI/             # 提供给 AI 的模板和例子，不作为正式数据
    ├── memories/
    └── skills/
```

## 正式评测数据

- `tasks/*.jsonl` 由 Eval Runner 读取；当前格式见 `tasks/memory_eval_v1.jsonl`。
- `skills/` 中每个 Skill 使用独立目录，并以 `SKILL.md` 为入口。`browser-use` 和 `docling-document-intelligence` 当前属于正式评测 Skill。
- `memories/` 只保存导入前的 L0 对话。由 MemoryCore 生成的 L1/L2/L3 不复制到这里，而是随统一数据底稿保存到 `tencentdb-memory-lab/data-builder/releases/`。
- `assets/` 建议按 `case_id` 建立子目录。当前 Runner 尚未根据任务自动复制这些文件，使用前需要在任务格式和 Runner 中增加对应字段。

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
