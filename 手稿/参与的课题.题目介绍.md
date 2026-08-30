# TDAI Memory 系统优化任务

> 面向开源贡献者的优化任务。两个任务独立可认领，可并行推进。

---

## 任务一：Proxy 系统提示词注入优化

### 核心目标

**用尽可能少的 token 注入工具描述，使模型在合适的时机正确调用工具，不在不需要时误调用。**

当我们往系统提示词里注入了记忆工具、skill 工具、知识工具后，模型应该能在相关 query 出现时主动调用对应工具（有效调用），同时在纯 coding 任务中不被这些注入内容干扰（避免误调用）。我们只关注"注入的工具描述能否让模型在正确时机识别并调用"，不关注工具返回的资产本身效果。

### 优化指标

| 指标 | 方向 |
|------|------|
| 有效调用率 | ↑ 应调用时模型实际调用了的比例 |
| 误调用率 | ↓ 不该调用时模型误触发的比例 |
| 工具选择正确率 | ↑ 调用后选对了工具的比例 |
| 注入 Token 量 | ↓ 系统提示词中工具描述占用的 token |

注意：注入内容的变更不应破坏 prompt cache（前缀稳定性）。

### 当前状况

MemoryProxy 在系统提示词中注入了多套工具描述块：

| 注入块 | 内容概述 |
|--------|----------|
| `<tdai_memory_tools>` | 6 个记忆工具的 curl 调用模板 + 调用约束 |
| `<memory-tools-guide>` | 记忆工具使用规则（何时必须查、何时不查） |
| `<tdai_profile_memory>` | L3 长期画像 + L2 场景索引 |
| `<skill_tools>` | 4-10 个 skill 工具的 curl 调用模板 |
| `<available_skills>` | 当前 agent 可用的 skill 列表 |
| `<knowledge_tools>` | 知识库工具描述 |

已知存在内容重叠（如调用约束在多处重复描述）。

### 可参考的优化方向

以下是一些思路供参考，不限于此：

- 合并重复内容（如 `<tdai_memory_tools>` 和 `<memory-tools-guide>` 中调用约束重复）
- 精简工具描述（缩短 use 字段、删除冗余示例、压缩错误码列表）
- 调整注入结构（多块分散 vs 合并成统一块）
- 优化措辞（强化触发条件描述，弱化操作细节）
- 调整注入位置（当前分别在 `system.before_tools` 和 `system.suffix`）
- 跨模型对比（不同模型对工具描述的敏感度差异，找出通用有效的描述方式）

### 交付物

- 实验报告：优化前后的指标对比数据（有效调用率、误调用率、token 节省量）
- 优化方案说明
- 代码 PR

### 相关代码

```
tdai-memory-openclaw-plugin/MemoryProxy/src/injection/
├── index.ts                            # Factory，注册所有 injector
├── pipeline.ts                         # 注入流水线编排
├── injectors/
│   ├── tdai-tools-injector.ts          # <tdai_memory_tools> 块
│   ├── tdai-profile-memory-injector.ts # <tdai_profile_memory> + <memory-tools-guide>
│   ├── skill-tools-injector.ts         # <skill_tools> 块
│   ├── skill-injector.ts              # <available_skills> 块
│   └── knowledge-tools-injector.ts    # <knowledge_tools> 块
```

每个注入块都有对应的 `render*Block()` 纯函数，修改该函数的输出即可。

---

## 任务二：Skill 机制优化

### 核心目标

**Skill 的目的是为模型去除无效的探索路径，大幅减少 turn 数。优化目标：在一批同类 coding 任务上，提高任务成功率、减少平均 token 消耗。**

理想情况：模型在没有 skill 时需要 20 个 turn 和大量试错才能完成任务，有了好的 skill 后只需 8 个 turn——skill 告诉它"该怎么做"，跳过无效探索。

优化过程中需要关注的平衡点：
- Skill 提取率太低 → skill 无法发挥作用
- Skill 提取太多 → 占用上下文干扰模型，蒸馏本身也消耗 token
- 需要找到最优平衡

### 优化指标

| 指标 | 方向 |
|------|------|
| 任务通过率 | ↑ pass@1 |
| 平均 Token 消耗 | ↓ 含蒸馏开销的总 token |
| 平均 Turn 数 | ↓ 完成任务所需的交互轮次 |
| Skill 提取率 | 找到最优值（非越高越好） |
| Skill 命中率 | ↑ 提取的 skill 中被后续任务实际用到的比例 |

理想的评测方式是选取一批 coding 任务来做实验，可以是同类型的、同一项目相关的任务等——这样能观察到 skill 的累积效应：前面任务蒸馏出的 skill 能否帮助后续任务做得更快更好。

### 当前机制

| 阶段 | 当前参数 | 说明 |
|------|----------|------|
| 归档触发 | toolCallThreshold=10, bytesThreshold=40KB | 对话中 tool_call 累计 >=10 次或消息 >=40KB 时触发 |
| LLM 抽取 | maxIterations=16 | 对归档内容跑最多 16 轮 tool-calling 循环提取 skill |
| Transcript 截断 | head=8000, tail=32000 chars | 保留对话头尾送入 LLM |
| 注入路由 | BM25, topK=20, charBudgetPercent=0.01 | 后续请求按关键词匹配相关 skill 注入 prompt |

### 可参考的优化方向

涵盖整条链路（触发 → 提取 → 注入），以下思路供参考：

**提取侧**：
- 触发条件调优（toolCallThreshold / bytesThreshold 的最优值）
- 抽取 prompt 精简（SKILL_REVIEW_PROMPT 较长，能否缩短且不损质量）
- maxIterations 降低（省 token，质量退化多少？）
- Transcript 截断策略优化

**注入侧**：
- 路由精度（BM25 / hybrid / embedding，哪种匹配最准）
- 注入量控制（topK 和 charBudgetPercent 的最优值，注入太多是否反而干扰）

**机制层**：
- 整套 skill 生命周期设计是否合理
- 可以调研同类方案的做法（Cursor Rules / CLAUDE.md / Windsurf Memory / Cline Memory Bank / Aider Conventions / Continue Context / OpenHands 等）

### 交付物

- 同类调研对比报告
- 实验报告：一批任务做下来，优化前后的指标对比（通过率、token、turn 数）
- 结论：推荐最佳配置，回答"多生成好还是少生成好"
- 代码 PR

### 相关代码

```
tdai-memory-openclaw-plugin/MemoryCore/src/core/skill/
├── skill-config.ts              # 所有参数配置（阈值、iterations、截断等）
├── skill-extractor.ts           # LLM 抽取入口
├── skill-tools.ts               # 抽取 agent 的 6 个工具定义
├── skill-core.ts                # Skill CRUD
├── skill-fast-path.ts           # 注入路由（BM25/hybrid）
├── prompts/
│   └── skill-review-prompt.ts   # 抽取 prompt（可优化）
├── conversation-add/
│   ├── add-handler.ts           # 归档触发逻辑（阈值判断在这里）
│   ├── extract-worker.ts        # 抽取 worker 流程
│   └── worker-pool.ts           # Worker 池
└── types.ts                     # 数据模型
```

---

## 参考资源

### 评测数据集（参考，可自行选择合适的 coding 场景数据集）

| 数据集 | 说明 | 链接 |
|--------|------|------|
| SWE-bench | 真实 GitHub issue 修复，同一 repo 多个 issue 天然构成"同类任务" | https://github.com/princeton-nlp/SWE-bench |
| HumanEval | 函数级代码生成 | https://github.com/openai/human-eval |
| MBPP | 简单编程题 | https://github.com/google-research/google-research/tree/master/mbpp |

### 环境搭建

- `MemoryCore/CLAUDE.md` — Core standalone gateway 启动方式
- `MemoryProxy/README.md` — Proxy 启动方式
- `docs/local-dev-full-guide.md` — 完整本地开发指南
