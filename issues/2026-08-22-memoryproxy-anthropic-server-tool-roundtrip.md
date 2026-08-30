# Anthropic Server Tool 注入往返字段丢失

- 发现时间：2026-08-22
- 组件：MemoryProxy / Anthropic injection adapter
- 影响版本：`v2.0.1-beta.2`（`29d609a`）
- 客户端：Claude Code 2.1.239
- 环境：Ubuntu 24.04、Node.js 22.23.2
- 状态：Native 已由真实 Claude Code Web Search 人工验证通过
- 上游 Issue：[#1135](https://github.com/TencentCloud/TencentDB-Agent-Memory/issues/1135)

## 现象

Claude Code 经 MemoryProxy 调用内置 Web Search 时，上游返回：

```text
API Error: 400 Invalid schema for function 'web_search': schema must be a JSON Schema of 'type: "object"', got 'type: null'.
```

Web Fetch 仍能执行，故障集中在工具定义被上游校验的阶段。

## 最小复现

1. 使用上述精确版本从源码启动 MemoryProxy，并启用 Anthropic 注入管线。
2. 将 Claude Code 指向代理，创建新会话。
3. 请求查询当天信息，使 Claude Code 调用内置 Web Search。
4. 观察 Web Search 返回 schema 400。

结构级最小复现是让以下 Server Tool 定义经过 Anthropic adapter 的解析和序列化：

```json
{"type":"web_search_20250305","name":"web_search","max_uses":5}
```

实际往返会丢失 `type`、`max_uses`，并补入 `input_schema: {}`。

## 根因证据

`MemoryProxy/src/injection/adapters/anthropic.ts` 中：

- `parseTool()` 只读取 `name`、`description`、`input_schema`、`cache_control`。
- `serializeTool()` 也只写回上述字段。
- Anthropic Server Tool 和未来扩展字段没有原始字段载体，因此无法无损往返。

## 验收条件

- `web_search_20250305` 的类型及扩展字段在完整注入往返后保持一致。
- 没有 `input_schema` 的 Server Tool 不被伪造空 schema。
- 普通自定义工具的 JSON Schema 行为保持不变。
- 增加 Server Tool 与普通工具的回归测试。

## 公开提交副本

- 标题：`[Bug] MemoryProxy corrupts Anthropic server tools during injection, causing Claude Code web_search 400`
- 正文：已使用脱敏英文主文和中文摘要提交至 [#1135](https://github.com/TencentCloud/TencentDB-Agent-Memory/issues/1135)。

## 后续

- 跟踪维护者的范围确认和修复建议。
- 若维护者接受贡献，再单独设计测试和修复 PR。

## Native 本地修复

- 分支：`research/native-tool`
- 在 `AgentTool` 增加可选的 `rawDefinition`，保存协议原生工具定义。
- Anthropic adapter 解析工具时浅拷贝完整原对象；序列化已有工具时以原对象为底，只同步原来存在的标准字段。
- MemoryProxy 新注入、没有原始定义的工具继续使用原有 `name`、`description`、`input_schema` 格式。
- 回归测试覆盖 `web_search_20250305`、`max_uses`、域名限制字段、缺失 `input_schema` 以及普通自定义工具。

验证结果：定向及全量 Vitest 通过；Native Proxy 已重启并在 `127.0.0.1:18096` 健康运行。2026-08-22 用户使用真实 Claude Code 会话触发 Web Search，搜索及结果返回均成功，未再出现代理制造的空 schema。

## 已发布正文

以下内容为 #1135 的提交正文副本：

## OpenClaw Version | OpenClaw 版本

N/A — reproduced with Claude Code 2.1.239.

## Plugin Version | 插件版本

TencentDB-Agent-Memory `v2.0.1-beta.2` (`29d609a729704ae31ff1848dc6f8acb7e712106d`).

## Operating System | 操作系统

Ubuntu 24.04, Node.js 22.23.2, source deployment.

## Describe the bug | 问题描述

When Claude Code sends an Anthropic server-side tool such as:

```json
{
  "type": "web_search_20250305",
  "name": "web_search",
  "max_uses": 5
}
```

through MemoryProxy with injection enabled, the Anthropic injection adapter parses and serializes every tool through its generic `AgentTool` representation. `parseTool()` and `serializeTool()` retain only `name`, `description`, `input_schema`, and `cache_control`.

As a result, Anthropic-specific fields such as `type: "web_search_20250305"` and `max_uses` are dropped. Because this server tool has no custom `input_schema`, the adapter also adds `input_schema: {}`. The upstream then treats `web_search` as a normal custom function and rejects the empty schema:

```text
API Error: 400 Invalid schema for function 'web_search': schema must be a JSON Schema of 'type: "object"', got 'type: null'.
```

The relevant round trip is implemented in:

- `MemoryProxy/src/injection/adapters/anthropic.ts`: `parseTool()`
- `MemoryProxy/src/injection/adapters/anthropic.ts`: `serializeTool()`

This appears to be a general lossless-forwarding issue: the proxy should not discard provider-specific or future Anthropic tool fields merely because they are not part of the internal normalized type.

### 中文摘要

Claude Code 通过 MemoryProxy 调用 Anthropic Server Tool `web_search_20250305` 时，注入适配器只保留普通自定义工具字段，导致 `type`、`max_uses` 等字段丢失，并额外生成空的 `input_schema: {}`。上游因此把它当成普通函数并返回 400。建议对未知字段和 Server Tool 定义进行无损透传。

## To Reproduce | 复现步骤

1. Check out `v2.0.1-beta.2` at commit `29d609a` and run MemoryProxy from source.
2. Configure an Anthropic-compatible upstream and enable the injection pipeline.
3. Point Claude Code 2.1.239 at MemoryProxy and start a new session.
4. Send a request that causes Claude Code to invoke its built-in Web Search tool, for example asking for today's weather.
5. Observe `Web Search(...)` fail with the 400 response shown above, while a subsequent URL fetch can still work.

The lossy transformation can also be seen directly by round-tripping the server-tool object above through `AnthropicAdapter.parseTool()` and `serializeTool()`: the output loses `type` and `max_uses` and gains an empty `input_schema`.

## Expected behavior | 预期行为

- Anthropic server-side tools retain their `type` and all provider-specific fields across the injection pipeline.
- Unknown/future tool fields are preserved unless MemoryProxy intentionally modifies them.
- Server tools without `input_schema` do not receive a fabricated empty schema.
- Existing custom tool definitions and their JSON Schema continue to work unchanged.

A regression test should cover both a normal custom tool and `web_search_20250305` through a full parse/inject/serialize round trip.

## Error Logs / Screenshots | 报错日志/截图

Sanitized proxy log excerpt:

```text
UPSTREAM_4xx status=400 body={"error":{"message":"Invalid schema for function 'web_search': schema must be a JSON Schema of 'type: \"object\"', got 'type: null'.","type":"invalid_request_error"}}
```

No raw screenshot is attached because the observability view contains experiment user and session identifiers.

## Additional context | 补充信息

Related issue: #990 reports that historical Anthropic `thinking` blocks are not passed back to the upstream after a tool-call turn. The symptoms are different, but both indicate that the Anthropic request round trip can lose provider-specific information. This issue is intentionally scoped to tool-definition preservation; additional reproduction details for thinking preservation will be added to #990 instead of opening a duplicate.
