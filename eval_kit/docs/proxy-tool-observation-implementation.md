# Proxy Tool 观测统计实施记录

依据：本会话用户已确认的「Proxy Tool 观测统计方案」。
只在本会话实施，不使用子智能体。不修改 dataset 和 data-preparation。

## 改动顺序
- [x] 在两组 MemoryProxy 增加默认关闭的 JSONL 发起记录及健康状态；先运行失败测试，再实现。
- [x] 在 Memory、Skill 的公共业务入口记录一次，Native 透传 callId；测试后端失败、多来源、重试。
- [x] 新增精简评测入口：运行映射校验、独立 Agent/Session、CLI Hooks、直接读文件、按案例汇总。
- [x] 跑 TypeScript/Vitest 和真实 Claude Code 小样本，记录结果与操作命令；Baseline 原有类型错误另行记录。

## 实施约束
使用现有桥接和工具名，不修改业务结果；不以 Langfuse 判断调用；不记录参数/结果/凭据。
记录文件写入失败只影响评测有效性，不改变工具业务。
运行前后检查同一服务进程和观测健康状态，防止故障被误算为零调用。
正式端到端计时继续等最终回答；空记录只有在采集和客户端均正常时才可计为未调用。
运行映射来自准备好的资产，Agent/Team/Session 不跨运行复用；数据准备本身仍是前置步骤。
