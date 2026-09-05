# 数据集修订与 30 Task 评测实施计划

> 在当前会话直接执行，不使用子智能体。用户已确认审查中的修正方向。

**目标：** 去掉数据泄漏、纠正评分与观察不一致的问题，固定 Memory / Skill / None 各 10 题，完成 Baseline / Native 共 60 次真实运行。

**方案：** 沿用现有独立 Agent、Session、工作区副本和 Bridge 观测。主评测按第一次工具选择评分并在首次调用后停止；Probe 单列。只改数据集与 eval_kit，不改两项目工具核心。

**技术：** TypeScript / Vitest、现有 CLI 容器和 MemoryCore 数据准备程序。

**依据：** 本次用户确认的 v2 数据审查及 30 题评测要求。

## 约束

- 保留上传的 v2 副本；不覆盖已有 Viewer 和项目修复。
- 两组同一题初始数据逐项核对，不独立重新提炼。
- 保留原 BM25、embedding=none；准备阶段最多 8192 Token，在线服务配置不改。
- 不把后续 Coding 失败当作已发生工具调用的丢失，不把服务错误当作漏调用。
- 在运行前固定样本和评分规则，不按结果挑题。

## 1. 数据检查和修订

- [x] 在 `eval_kit/tests/dataset-quality.test.ts` 增加对所有工作区类别编号、主评测 first-tool 标签、Skill 资源引用、Memory 索引的检查，先运行观察失败。
- [x] 清理 `dataset/assets` 中暴露类别的说明和 fixture 字段；修正不成立的 query，统一候选数量。
- [x] 移动 Docling 根目录参考文件到 `references/`，同步修改 Skill 和任务引用。
- [x] 删除无业务意义的编号填充，补入真实项目讨论，分散目标事实位置并更新所有引用；在修订说明中记录数量变化。
- [x] 再运行数据检查，确认来源完整且实际导入器能读到资源。

## 2. 评测入口

- [x] 为 `selectPilotCases()` 增加固定 seed、跨场景抽样以及大于场景数的数量测试。
- [x] 修正 `pipeline/config.ts` 和运行入口，仅添加必要配置；保留 Main / Probe 区分。
- [x] 将新配置 `configs/pilot-30.yaml` 固定为每类 10 题、首次调用停止。提前检查引用、保存选择结果。
- [x] 运行 `npm run typecheck` 与全部 `npm test`。

## 3. 实际运行与报告

- [x] 检查服务、埋点和 CLI；执行 `npm run pipeline -- --config configs/pilot-30.yaml`。
- [x] 观察 L1/L2/L3、配对数据核对及 60 次 CLI；失败先保留证据，再做最小评测层修复，不改工具核心。
- [x] 检查 Memory 注入是否已回答问题、资源清单和会话身份；记录不能由自动检查判断的标签边界。
- [x] 汇总有效调用、错误选择、误调用与无效运行；说明这不是 Coding 正确率或完整端到端延迟实验。
- [x] 写 `eval_kit/docs/pilot-30-task-report.md`，包括数据变更、运行明细、问题与修复、风险和复跑命令。
