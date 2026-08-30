# thinking 历史块在转发前被清理

- 发现时间：2026-08-22
- 组件：MemoryProxy / Anthropic handler
- 影响版本：`v2.0.1-beta.2`（`29d609a`）
- 客户端：Claude Code 2.1.239
- 环境：Ubuntu 24.04、Node.js 22.23.2
- 状态：第二轮修复已部署，待新会话人工复测
- 上游 Issue：[#990](https://github.com/TencentCloud/TencentDB-Agent-Memory/issues/990)
- 评论链接：[issuecomment-5380730741](https://github.com/TencentCloud/TencentDB-Agent-Memory/issues/990#issuecomment-5380730741)

## 现象

在会话初始化或工具调用后的续轮请求中，上游可能返回：

```text
API Error: 400 The `content[].thinking` in the thinking mode must be passed back to the API.
```

## 根因证据

`MemoryProxy/src/anthropicHandler.ts` 中：

- `sanitizeThinkingBlocks()` 会检查历史 assistant 消息。
- 未通过 `hasValidThinkingSignature()` 的 `thinking` 和 `redacted_thinking` 块会被删除。
- `buildUpstreamBody()` 在转发前无条件调用该清理函数。

当 Anthropic 兼容上游的签名缺失或格式不符合代理侧启发式规则时，上游要求回传的块可能被代理删除。

## 验收条件

- 工具调用后的下一轮请求能完整保留供应商要求的 thinking 历史。
- 清理行为如确有必要，应明确限定供应商并可配置，而不是依赖全局启发式规则。
- 增加工具调用续轮与 `redacted_thinking` 的回归测试。
- 修复后不再出现对应 400，且普通非 thinking 会话不受影响。

## 上游协作

- 不重复新建 thinking Issue。
- 向 #990 补充 Linux、较新版本组合的独立复现及源码分析。
- 在评论中关联 Anthropic Server Tool 无损往返的新 Issue。

## 后续

- 跟踪 #990 的维护者回复和代码变更。
- 修复发布后在 Baseline/Native 环境分别回归验证。

## Native 本地修复

- 分支：`research/native-tool`
- 删除代理侧对 thinking 签名长度、UUID 和 Base64 格式的启发式判断。
- 保留 `sanitizeThinkingBlocks()` 导出作为兼容入口，但改为返回原始 body、`removed: 0` 的透明 no-op。
- 主请求和自动重试继续经过同一入口，因此都会保留 `thinking` 与 `redacted_thinking` 历史块。
- 响应端对缺失 `thinking` 字段的格式修补逻辑未改动。

回归测试覆盖供应商自定义签名、无签名 `redacted_thinking`、后续 `tool_use` 与 `tool_result`，确认整个请求对象保持同一引用且没有块被删除。

## 第一次人工复测与第二根因

2026-08-22 第一次人工复测仍在 Session Init 完成后的首个上游请求收到 thinking 400。日志确认新请求没有再执行 thinking 删除，但错误只在三次 `AskUserQuestion` 选择完成后出现；随后重发普通消息及 Web Search 均成功。

进一步定位到 `session/claude-code/form.ts`：MemoryProxy 伪造的 Session Init assistant 响应只有 `tool_use`，即使原 Anthropic 请求启用了 extended thinking，也没有生成 thinking block。Claude Code 把这些伪造历史回传给 DeepSeek 后，触发“thinking 模式必须回传 `content[].thinking`”校验。

第二轮修复：

- 从请求 `body.thinking.type === "enabled"` 精确读取 thinking 状态。
- 经 `SessionRequestContext` 和 `FormData` 传到全部六个 Session Init 表单分支。
- thinking 开启时，伪造 SSE 先输出非空 `thinking` block（索引 0），再输出 `AskUserQuestion` tool_use（索引 1）。
- thinking 关闭时保持原结构，tool_use 仍位于索引 0。
- 新增启用/关闭两种 SSE 回归测试；全量 Vitest 当前 5 项全部通过。

由于旧会话历史中已经保存了缺失 thinking 的伪造 assistant 消息，第二轮修复必须用全新 Claude Code Session 完整走一次 Team/Agent/Task 选择流程进行验证。

## 已发布评论

以下内容为 #990 补充评论的正文副本：

I can independently reproduce this on Linux with a newer project/client combination:

- TencentDB-Agent-Memory `v2.0.1-beta.2` (`29d609a`)
- Claude Code 2.1.239
- Ubuntu 24.04 / Node.js 22.23.2
- Anthropic-compatible upstream

The 400 occurs at the session-initialization/tool-call boundary:

```text
API Error: 400 The `content[].thinking` in the thinking mode must be passed back to the API.
```

Source inspection points to `MemoryProxy/src/anthropicHandler.ts`:

- `sanitizeThinkingBlocks()` iterates over prior assistant messages and removes `thinking` and `redacted_thinking` blocks unless `hasValidThinkingSignature()` accepts the signature.
- `buildUpstreamBody()` applies this sanitizer unconditionally before forwarding the request upstream.

For an Anthropic-compatible provider whose thinking signature is absent or does not satisfy this proxy-side heuristic, a block required by the provider can therefore be deleted before the next request. It may be safer for MemoryProxy to preserve historical thinking blocks by default, or make provider-specific sanitization explicit/configurable, with regression coverage for a tool-call continuation turn.

I also found a related but distinct lossless-round-trip problem for Anthropic server-side tool definitions and opened #1135. Both cases suggest that provider-specific Anthropic request fields should survive proxy injection/forwarding unless an explicit transformation is required.

### 中文补充

在 Ubuntu 24.04、TencentDB-Agent-Memory `v2.0.1-beta.2` 和 Claude Code 2.1.239 下可以独立复现。当前 `sanitizeThinkingBlocks()` 会在转发前删除未通过代理签名规则的 `thinking`/`redacted_thinking` 块；对签名格式不同的 Anthropic 兼容上游，这可能正好删除下一轮请求必须回传的思考块。建议默认保留，或把清理策略改为显式、可配置的供应商兼容行为。
