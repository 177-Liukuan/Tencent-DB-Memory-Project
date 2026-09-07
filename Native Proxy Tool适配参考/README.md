# Native Proxy Tool 适配参考

> 文档性质：内部分析与实施参考，不是最终技术规范。
>
> 使用原则：以实际源码、接口契约和正式实验结果为准；文档中的 Prompt、Tool Description、Schema 与模块边界均可在实现时调整。

## 目录用途

本目录集中整理 TencentDB Agent Memory 从 Fake Tool 迁移到 Native Proxy Tool 过程中，对现有 MemoryProxy 注入内容和相关工具能力的分析，供后续编码、评测及问题归因使用。

这里的材料主要回答：

1. 现有注入内容究竟来自哪里、承担什么职责；
2. 哪些内容属于 Fake Tool 的传输细节，应当删除；
3. 哪些信息应迁移到 Native Proxy Tool Schema、Tool Description 或 MemoryProxy 运行时；
4. 哪些跨工具决策规则仍可能需要保留在精简后的 System Prompt 中；
5. 如何通过 A/B 评测决定最终保留内容，而不是仅凭主观判断定稿。

## Baseline 与 Native 的边界

- **Native 项目不会保留原有 Fake Tool 的注入实现、curl 指南、兼容开关或回退路径**，只实现 Native Proxy Tool 方案；
- 需要查看旧提示词、Fake Tool 调用方式或进行真假工具对照时，应以 `TencentDB-Agent-Memory-Baseline/` 为准，不应要求 Native 项目继续保存一份旧实现；
- 本目录引用和分析 Fake Tool 内容只是为了辅助迁移与评测，不表示相关代码会继续存在于 Native 项目中。

Memory Fake Tool 的主要对照入口为：

- [Baseline `<memory-tools-guide>` 定义](../TencentDB-Agent-Memory-Baseline/MemoryProxy/src/injection/injectors/tdai-profile-memory-injector.ts)
- [Baseline `<tdai_memory_tools>` 定义](../TencentDB-Agent-Memory-Baseline/MemoryProxy/src/injection/injectors/tdai-tools-injector.ts)

后续 Skill、Knowledge 分析也遵循同一原则，并在各自文档中链接 Baseline 的对应文件。

## 当前文档

| 文档 | 状态 | 内容 |
| --- | --- | --- |
| [memory-tools-guide适配参考.md](./memory-tools-guide适配参考.md) | 初稿 | 分析 `<memory-tools-guide>` 的真实职责，并给出 Native Proxy Tool 初步适配结果 |
| [memory-fake-tools适配参考.md](./memory-fake-tools适配参考.md) | 初稿 | 梳理六个 Memory Fake Tool，并给出一对一迁移为 Native Proxy Tool 的首版设计 |
| [skill-fake-tools适配参考.md](./skill-fake-tools适配参考.md) | 初稿 | 梳理十个 Skill Fake Tool，并给出完整实现、按权限暴露的 Native Proxy Tool 设计 |
| [knowledge-tools适配参考.md](./knowledge-tools适配参考.md) | 初稿 | 拆分 `<knowledge_tools>` 的资源目录与 curl Fake Tool，并给出两步 Native Proxy Tool 适配方案 |

后续可继续在本目录增加 Memory、Skill、Knowledge 的工具清单、注入内容、Schema、Tool Description、权限边界和评测结论。文件应尽量按一个明确主题拆分，避免形成一份难以维护的超长总文档。

## 文档状态约定

- **初稿**：依据当前源码提出的候选设计，仅供讨论和首轮实现参考；
- **已验证**：已经通过固定数据集或工程测试验证，并记录实验版本；
- **已采用**：已经进入 Native 项目实现，文档与对应代码 Commit 建立关联；
- **已废弃**：结论已被新实现或实验推翻，仅保留历史原因。

任何初稿都不能直接视为最终 Prompt 或接口契约。正式实现基线以根目录的 [Native Proxy Tool 课题目标与技术实施方案（内部）](<../Native Tool课题目标与技术实施方案（内部）.md>)、Native 项目实际代码及其测试为准。
