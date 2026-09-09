# [Bug] MemoryProxy 已指定 Team 仍加载全部团队目录，超时后整个会话不再注入资产

- 提交时间：2026-09-08T05:44:27Z
- 组件：MemoryProxy / Claude Code 会话初始化
- 状态：已提交（上游 OPEN，核对日期：2026-09-09）
- 上游 Issue：[#1285](https://github.com/TencentCloud/TencentDB-Agent-Memory/issues/1285)
- 上游正文最后更新时间：2026-09-08T07:18:10Z

以下为已公开提交的 Issue 正文副本。保留原文中的版本、观测范围及验证限制，不将本地诊断结果表述为上游修复结论。

## 公开提交正文

### OpenClaw Version | OpenClaw 版本

不涉及 OpenClaw，客户端是 Claude Code 2.1.263。

### Plugin Version | 插件版本

本地以 `v2.0.1-beta.2`（`29d609a`）为基础运行 MemoryProxy / MemoryCore。
另外检查了上游默认分支 `feat/server_team` 的 `220af62226221d7ea07f95aa61eb7c0486cb407a`，下面提到的处理逻辑仍然存在。这是源码核对，没有在最新版重新跑完整实验。

### Operating System | 操作系统

Ubuntu 24.04.2 LTS，Node.js 22.23.2，standalone 部署，元数据使用 SQLite。

### Describe the bug | 问题描述

本 Issue 跟踪一条具体的失败路径：**请求头已指定有效身份 → 初始化仍读取所有可见团队的目录 → 某个目录请求超时 → 会话被标记为 bypass，后续持续跳过资产注入。**

我在用 Claude Code 接入 MemoryProxy 做批量任务测试，每次会话都通过请求头指定有效的 Team、Agent 和 Task。

实际发现，Proxy 会先读取当前账号下**所有团队**的 Agent 和 Task，等全部读取完，才匹配请求头指定的身份。这样一来，一个与当前任务无关的团队目录请求超时，也会让当前会话初始化失败。

更麻烦的是，失败后会话被保存为 `initialized + bypassed`，但 `sessionInfo` 是空的。之后继续在同一会话发消息，仍然跳过资产注入。用户可能还在和模型正常聊天，却没有拿到原本应该注入的记忆和 Skill。

这里不是认为“请求不能设置超时”，而是：
- 已经指定目标团队，却仍依赖所有团队的目录都读取成功。
- 临时的目录读取失败，被当成了这个会话后续一直跳过注入的状态。

### To Reproduce | 复现步骤

1. 准备一个能访问多个 Team 的用户，在目标 Team 下创建该用户有权使用的 Agent 和 Task。其他 Team 也放一些 Agent / Task，使列表需要分页。
2. 开启 session init 和请求头自动选择：

   ```yaml
   sessionInit:
     enabled: true
     headerAutoSelect:
       enabled: true
       teamHeader: x-team-id
       agentHeader: x-agent-id
       taskHeader: x-task-id
       onMismatch: form
   skill:
     timeoutMs: 5000
   ```

   其余 endpoint、鉴权等使用正常的有效配置。
3. 创建新的 Claude Code 会话，在请求中带上有效的 `x-team-id`、`x-agent-id`、`x-task-id`。
4. 观察初始化期间的请求：除了目标 Team，其他 Team 的 `/v3/meta/agent/list` 和 `/v3/meta/task/list` 也会被请求。
5. 任意一个列表请求超时后，检查会话状态和后续注入日志；继续向同一会话发消息，仍然会看到 `bypassed → skipping all injection`。

数量较少、机器空闲时可能不容易碰到超时。要稳定验证这个分支，可以在测试中让**非目标 Team** 的一个列表请求抛出 timeout，同时保证目标 Team 的接口正常。这是建议的确定性复现方法，不是说我已在纯上游版本运行过这项测试。

### Expected behavior | 预期行为

请求头已经指定目标 Team 时，先检查这个 Team 对当前用户是否可见，再读取它的 Agent / Task，并保留现有权限和归属检查。其他团队读取慢，不应影响这次已经指定目标的绑定。

临时读取失败也不应静默变成这个会话一直跳过注入；至少应让调用方知道初始化失败，并能在服务恢复后重新尝试。用户主动选择跳过，可以继续保持原来的语义。

### Error Logs / Screenshots | 报错日志/截图

下面是同一会话的关键日志，用户和会话标识已替换：

```text
[session-init:cc] session=claude-code:<session-id> state=none → uninitialized
[session-init:cc] session=claude-code:<session-id> kernel unavailable for user=<user-id>, bypassing: [metadata-client] /v3/meta/agent/list fetch failed: The operation was aborted due to timeout
[session-init] session=<session-id> bypassed → skipping all injection
[session-init] session=<session-id> bypassed → skipping all injection
```

另一些会话超时的是 `/v3/meta/task/list`，后续行为相同。

### Related Issues / PRs | 与已有讨论的区别

已有讨论报告过初始化失败后静默跳过注入的现象。本 Issue 与它们有相似后果，但触发条件和需要修复的代码路径不同：

| 已有讨论 | 触发条件与根因 | 与本 Issue 的区别 |
| --- | --- | --- |
| #1145：团队 0 Task 时静默 bypass | 交互式初始化中，选定的团队没有 Task，分支直接进入 bypass。 | 本次目标 Team、Agent、Task 均有效；失败发生在目录加载阶段。 |
| #1176：多 Team 下选择单 Agent 团队失败 | OpenCode 交互表单无法处理只有一个 Agent 的选项页，重试后放弃绑定。 | 本次使用请求头自动选择身份，不依赖该交互表单；超时发生在匹配身份之前。 |
| #1239：WorkBuddy 资产绑定失败 | 包含表单答案中的“跳过”字样被误判，以及单 Agent 表单处理问题。 | 本次没有因表单答案解析而选择跳过，而是目录请求异常被保存为 bypass。 |
| PR #1129：请求头身份在缓存未命中时被忽略 | 历史恢复找不到交互表单标记，提前进入 one-shot bypass，未进入正常的请求头注册流程。 | 本次日志已进入初始化的 `uninitialized` 分支，随后在加载 Agent / Task 目录时超时；不是历史扫描提前拦截。 |

本 Issue 重点是两个相连的问题：

1. **读取范围过大：** 已经指定目标 Team，当前绑定仍依赖其他团队目录成功返回。
2. **失败状态难以恢复：** 临时目录异常被保存为持续跳过注入的会话状态，后续请求无法自然恢复。

这些讨论共同说明静默 bypass 值得关注，但修复表单、0 Task 或历史恢复分支，不等于解决本次目录加载失败路径。此次检索未发现明确针对这一完整路径的同根因报告；如已有对应讨论，欢迎关联或合并。

### Additional context | 补充信息

**本地观察到的规模：**

同一账号可见 10 个 Team，列表每页 100 条，加上分页，一次初始化需要约 37 次目录请求。两组本地部署各运行了 273 个会话，分别有 22 次和 49 次初始化失败；逐一对应日志后，这 71 次全部是 Agent / Task 列表请求超时。

这是本地分支上的观测，不是官方版本的失败率。两组都带有本地修改，其中包括同会话初始化串行处理的补丁，用来避免“一个初始化成功后，被另一个迟到的失败覆盖”。本次失败会话没有先成功再被覆盖的记录；全目录读取和超时后 bypass 的逻辑没有被该补丁修改。Native 组还有工具调用方式的改造，因此这里不据此比较两组优劣。

**超时时间也需要区分：**

官方代码默认 `coreSkill.timeoutMs` 是 1,500 ms；本地已配置为 5,000 ms，仍出现上述问题，不能把 5,000 ms 写成官方默认值。

只读诊断中，一次全目录加载分别用了约 4.32 秒和 4.65 秒，其中最慢单个请求等待约 4.16 秒和 4.53 秒。保留 Team 可见性检查、只读取目标 Team 时，均变为 7 次请求，约 0.8 秒。这里只是单次诊断对照，不代表修复已经完成验收。

Core 日志中的单个接口处理多数只有百余毫秒，和客户端总等待时间不同。因此目前不能把原因简单归结为某条目录 SQL 慢；可以确认的是请求放大、等待累积，以及随后进入持续 bypass 的处理路径。

**相关代码（固定到上述上游提交）：**

- [先读取所有 Team 的 Agent / Task](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/220af62226221d7ea07f95aa61eb7c0486cb407a/MemoryProxy/src/session/claude-code/init.ts#L112-L155)
- [列表读取异常后保存 initialized + bypassed](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/220af62226221d7ea07f95aa61eb7c0486cb407a/MemoryProxy/src/session/claude-code/init.ts#L721-L740)
- [之后才匹配请求头指定的身份](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/220af62226221d7ea07f95aa61eb7c0486cb407a/MemoryProxy/src/session/claude-code/init.ts#L763-L765)
- [每页请求的超时处理](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/220af62226221d7ea07f95aa61eb7c0486cb407a/MemoryProxy/src/meta/client.ts#L541-L550)
- [默认超时时间](https://github.com/TencentCloud/TencentDB-Agent-Memory/blob/220af62226221d7ea07f95aa61eb7c0486cb407a/MemoryProxy/src/config.ts#L124-L129)

建议先从“已指定身份时缩小目录读取范围”修起，不需要改变工具描述或取消权限检查。
