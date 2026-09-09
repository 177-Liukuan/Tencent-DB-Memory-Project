# TencentDB Agent Memory 问题档案

本目录记录课题开发和实验过程中发现、已脱敏并可公开复现的问题。原始密钥、内部地址、完整用户或会话标识以及未经脱敏的可观测性截图不得写入本目录。

| 日期 | 问题 | 组件 | 状态 | 上游链接 | 下一步 |
|---|---|---|---|---|---|
| 2026-09-08 | [已指定 Team 仍加载全部团队目录，超时后持续跳过资产注入](2026-09-08-memoryproxy-session-init-directory-timeout-1285.md) | MemoryProxy | 已提交（上游 Open） | [#1285](https://github.com/TencentCloud/TencentDB-Agent-Memory/issues/1285) | 跟踪目录读取范围与失败恢复的上游处理 |
| 2026-08-22 | Anthropic Server Tool 在注入往返中字段丢失 | MemoryProxy | Native 人工验证通过 | [#1135](https://github.com/TencentCloud/TencentDB-Agent-Memory/issues/1135) | 跟踪上游反馈并准备 PR |
| 2026-08-22 | thinking 历史块被代理清理及伪造表单缺块 | MemoryProxy | 第二轮修复已部署，待新会话复测 | [#990 评论](https://github.com/TencentCloud/TencentDB-Agent-Memory/issues/990#issuecomment-5380730741) | 新建 Session 完整走初始化流程 |

## 记录规范

- 每个问题单独建立 Markdown 文件，记录版本、现象、最小复现、根因证据和验收条件。
- 公开提交后的 Issue、评论或 PR 链接必须回填。
- 状态使用“待提交、已提交、已确认、修复中、待验证、已解决”。
- 只保存必要的脱敏日志片段，不复制完整运行日志。
