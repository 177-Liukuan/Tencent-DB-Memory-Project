# Proxy Tool 观测实现与验证记录

日期：2026-09-05。实现范围：两组 MemoryProxy 的评测埋点、eval_kit 新运行入口及本机启动检查例外。
未修改 dataset、data-preparation、Memory/Skill 业务结果、工具超时/重试、Native 历史存储和压缩机制。

## 已实现

- 两组在 Memory/Skill Bridge 入口同步追加 JSONL 发起事件。
- 默认关闭；开启后仅记录 Session、事件 ID、工具名/类别、时间、Native callId。
- Memory 多来源访问只记录一次入口；Native 重试通过同一 callId 去重。
- Runner 使用运行映射中的独立 Agent/Team/Task，创建新的 Session 与工作区。
- Agent 使用登记为一次性；重复实验不能覆盖已有结果、不能重复消耗同一 Agent。
- 新入口不依赖 Langfuse/ClickHouse 采集；文件/服务异常不会算成未调用。
- Native 自动配置官方 Hooks，修正旧 --bare 禁用 Hook 的不兼容。
- 按 Task 执行样本统计 Memory、Skill、总体调用率/误调用率/选择正确率，继续测真实端到端延迟。
- 保留 legacy:run 用于历史实验；静态 Token 工具仍可独立使用。

核心源码：
- 两组 MemoryProxy/src/memory/tool-observation.ts
- 两组 MemoryProxy/src/memory/memory-bridge.ts、src/skill/skill-bridge.ts
- Native MemoryProxy/src/native-proxy-tools/bridge-tool-executors.ts
- eval_kit/bridge-eval/config.ts、observations.ts、runner.ts
- eval_kit/runner/client.ts、cli.ts

## 自动化测试

| 模块 | 结果 |
|---|---|
| eval_kit TypeScript | 通过 |
| eval_kit Vitest | 136 passed |
| Native MemoryProxy TypeScript | 通过 |
| Native MemoryProxy Vitest，NATIVE_TOOL_CLICKHOUSE_TEST=1 | 437 passed，0 skipped |
| Baseline MemoryProxy Vitest | 20 passed |
| Baseline MemoryProxy TypeScript | 6 项原有错误，本次没有新增 |

Native 全量测试实际连接本机 ClickHouse，包含 5 项短期状态集成测试、2 项 Ledger 集成测试，不是环境跳过。
Baseline 另外从 Git HEAD 导出未修改源码到临时目录，使用同一依赖独立执行 TypeScript 检查，复现完全相同的 6 项错误：
anthropicHandler 的 RequestKind、codexHandler 的 traceId、RawYamlConfig 缺 memCommand（三处）、缺 @context-proxy/cost-guard 类型模块。
没有为让 Baseline 编译变绿而修改这些业务代码。

本次新增测试涵盖：写入在后端之前、后端失败仍有记录、不保存参数、路径穿越拒绝、
日志失败健康检查、Native 重试和 Memory 多来源、事件去重/冲突、独立身份、无效采集、Agent 不可复用、
真实 CLI 子进程设置生成和 final result 计时。

## 真实 Claude Code 验证

客户端为 Claude Code 2.1.261；模型为 deepseek-v4-flash[1m]，两组均使用 Anthropic 上游。
没有 Mock。通过正式的新 Runner 启动真实 Claude --print，实际访问两组 Core。
每次运行创建独立 Team、Agent、Task、Session；两组初始 Memory 为空，Skill 案例导入相同的 observation-smoke 正文。

第一组结果：eval_kit/results/bridge-observation-smoke-1788585862985

| 场景 | Baseline 观测调用 | Native 观测调用 | 验证 |
|---|---|---|---|
| Memory 查询 | tdai_memory_search ×1 | tdai_memory_search ×2 | 均完成真实查询并报告空结果；Native 两次为不同调用 ID |
| Skill 正文 | skill_view ×1 | skill_view ×1 | 均读出预置校验口令 bridge-observation-2026 |
| 普通计算 | 0 | 0 | 均返回 42，健康采集下的真实零调用 |

第二组结果：eval_kit/results/bridge-observation-smoke-1788586299802

| 场景 | 实际发起顺序 |
|---|---|
| Baseline 同时使用 Memory、Skill | tdai_memory_search → skill_view → tdai_conversation_search |
| Native 同时使用 Memory、Skill | tdai_memory_search → skill_view |

两次多工具运行都正常结束且采集有效。Baseline 额外查询了原始对话，所以按该测试预设的严格工具集合得到选择错误；
这属于模型行为，不是采集失败，没有为了让指标好看而丢掉额外调用。

共 8 次真实运行均完成，记录能关联到各自 Task；这证明采集及运行流程可用，不构成正式 A/B 调用效果或性能结论。
真实测试提示词明确要求调用工具，属于观测校验，不混入正式 main 数据集。
本次创建的 8 套测试 Team/Agent/Task 与结果保留用于复查，不与后续正式评测共用。

## 部署与剩余前置条件

8096 Baseline、18096 Native 已启用观测。末次健康检查均为 ok，toolObservation.enabled/healthy 均为 true。
本机 Baseline preflight 仍检查冻结 HEAD、端口隔离和密钥权限，只对明确登记的 tracked 观测补丁允许启动；具体见使用说明。

正式批量评测前，仍须从相同底稿准备每个 Task 的独立资产和身份，填写运行映射表。
现有 data-preparation 尚不自动产出逐 Task 身份表；本任务按已确认方案保留该模块不变。
seed_version 只是准备阶段声明，不能替代资产一致性验收。
第一版不做任意模型调用意图捕获、多实例收集、失败 Agent 自动重置或并行模型输出顺序重建。

