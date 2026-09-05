import { describe, expect, it } from "vitest";

import {
  extractBaselineCurlCall,
  normalizeClaudeStream,
  pairNativeToolBlocks,
} from "../recorder/tool-registry.js";

describe("tool registry", () => {
  it("does not classify ordinary Bash text mentioning an endpoint as a tool invocation", () => {
    expect(extractBaselineCurlCall("echo https://example/memory-bridge/v3/atomic/search", "echo")).toBeNull();
  });

  it("keeps an existing result when later model requests repeat the same tool call", () => {
    const call = { role: "assistant", content: [{ type: "tool_use", id: "repeat", name: "skill_view", input: { skill_name: "x" } }] };
    const records = pairNativeToolBlocks([call, { role: "user", content: [{ type: "tool_result", tool_use_id: "repeat", content: "saved" }] }, call]);
    expect(records).toHaveLength(1);
    expect(records[0]?.result).toBe("saved");
  });
  it("normalizes a Baseline Bash/curl endpoint and JSON arguments", () => {
    const call = extractBaselineCurlCall(
      "curl -sS -X POST 'http://127.0.0.1:8097/memory-bridge/v3/conversation/search' -H 'content-type: application/json' --data '{\"query\":\"A/B\"}'",
      "toolu_1",
    );
    expect(call).toMatchObject({
      call_id: "toolu_1",
      logical_name: "tdai_conversation_search",
      kind: "managed",
      arguments: { query: "A/B" },
    });
  });

  it("normalizes dynamic knowledge resource endpoints", () => {
    expect(extractBaselineCurlCall(
      "curl -sS -X POST 'https://knowledge.example/tools/list' --data '{\"knowledge_id\":\"wiki-1\"}'",
      "toolu_knowledge",
    )).toMatchObject({
      logical_name: "tdai_knowledge_tools_list",
      arguments: { knowledge_id: "wiki-1" },
    });
  });

  it("keeps an unknown client tool distinct from managed tools", () => {
    const records = normalizeClaudeStream([
      {
        type: "assistant",
        message: { content: [{ type: "tool_use", id: "toolu_x", name: "Bash", input: { command: "echo hi" } }] },
      },
    ]);
    expect(records.tool_calls).toEqual([
      expect.objectContaining({ logical_name: "Bash", kind: "client" }),
    ]);
  });

  it("preserves client-stream tool start and result timestamps", () => {
    const records = normalizeClaudeStream([
      {
        type: "assistant",
        timestamp: "2026-08-31T00:00:00.100Z",
        message: { content: [{ type: "tool_use", id: "toolu_time", name: "skill_view", input: { skill_name: "x" } }] },
      },
      {
        type: "user",
        timestamp: "2026-08-31T00:00:00.250Z",
        message: { content: [{ type: "tool_result", tool_use_id: "toolu_time", content: "ok" }] },
      },
    ]);
    expect(records.tool_calls[0]).toMatchObject({
      started_at: "2026-08-31T00:00:00.100Z",
      ended_at: "2026-08-31T00:00:00.250Z",
      latency_ms: 150,
    });
  });

  it("pairs Native tool_use and tool_result blocks across messages", () => {
    const records = pairNativeToolBlocks([
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "skill_view", input: { name: "memory-proxy-injection-map" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_2", content: "skill body" }] },
    ]);
    expect(records).toEqual([
      expect.objectContaining({
        call_id: "toolu_2",
        logical_name: "skill_view",
        kind: "managed",
        result: "skill body",
      }),
    ]);
  });

  it("marks a non-zero business envelope as a tool error", () => {
    const records = pairNativeToolBlocks([
      { role: "assistant", content: [{ type: "tool_use", id: "toolu_3", name: "skill_view", input: { skill_name: "missing" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_3", content: "{\"code\":40401,\"message\":\"SKILL_NOT_FOUND\"}" }] },
    ]);
    expect(records[0]?.error).toContain("40401");
    expect(records[0]?.error).toContain("SKILL_NOT_FOUND");
  });
});
