# 评测操作约定

- 每轮评测 Baseline、Native 各建一个 Team；每个任务新建独立的 Agent、Task、Session 和工作区副本，不再逐任务创建账号和团队。
- 两组使用各自 `lab_root/<variant>/secrets/memory-user.key` 对应的账号创建并运行，当前必须对应 `rhino-researcher`（`usr-f7iwo2muhb`）。Agent 归该用户所有，才能在 MemoryHub 的 Agent 资产页查看私有 Memory 和 Skill；仅加入为 member 不够。
- Task 名称为 `task_n`、描述为“完成用户请求”；Agent 名称为 `agent_n`、描述为“处理通用开发任务与日常协作”。名称不带数据集类别。
- `team_member_user_ids` 仅用于添加其他查看者；创建者已是 owner/admin，不再重复添加。Skill 保持默认私有，不自动共享到团队或绑定其他任务的 Memory。
