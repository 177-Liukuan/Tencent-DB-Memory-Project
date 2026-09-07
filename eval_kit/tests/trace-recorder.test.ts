import { describe, expect, it } from "vitest";

import { normalizeTrace } from "../recorder/trace-recorder.js";

describe("trace recorder normalization", () => {
  it("recognizes Baseline calls from model observations even when the CLI record is missing", () => {
    const normalized = normalizeTrace({
      variant: "baseline", tapEvents: [], clientEvents: [], clickhouseRows: [], traceComplete: true, langfuseBaseUrl: "", langfuseProjectId: null,
      observations: [{ type: "GENERATION", name: "model", metadata: { protocol: "anthropic" }, output: { role: "assistant", content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "curl http://127.0.0.1/memory-bridge/v3/atomic/search -d '{\"query\":\"history\"}'" } }] } }],
    });
    expect(normalized.tool_calls).toEqual([expect.objectContaining({ logical_name: "tdai_memory_search", kind: "managed", arguments: { query: "history" } })]);
  });

  it("does not borrow a same-name or positional Bridge result for a different call ID", () => {
    const normalized = normalizeTrace({
      variant: "native", tapEvents: [], clientEvents: [], traceComplete: true, langfuseBaseUrl: "", langfuseProjectId: null,
      observations: [{ type: "GENERATION", name: "model", metadata: { protocol: "anthropic" }, output: { role: "assistant", content: [
        { type: "tool_use", id: "a", name: "skill_view", input: {} },
        { type: "tool_use", id: "b", name: "skill_view", input: {} },
      ] } }],
      clickhouseRows: [{ call_id: "a", initiated_tool: "skill_view", kind: "bridge_call", executed_endpoint: "/skill/get-by-name", upstream_status: 500, elapsed_ms: 12 }],
    });
    expect(normalized.tool_calls[0]?.error).toBe("Upstream HTTP 500");
    expect(normalized.tool_calls[1]?.error).toBeNull();
    expect(normalized.tool_calls[1]?.latency_ms).toBeNull();
  });
  it("merges tap, Claude stream, Langfuse and ClickHouse without duplicating a tool call", () => {
    const normalized = normalizeTrace({
      variant: "native",
      tapEvents: [{ kind: "request", at: "2026-08-31T00:00:00.000Z", method: "POST", path: "/v1/messages", headers: { authorization: "[REDACTED]" }, body: { system: "raw", messages: [{ role: "user", content: "q" }], tools: [] } }],
      clientEvents: [
        { type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "inspect the available skill" }] } },
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "skill_view", input: { name: "x" } }] } },
        { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "body" }] } },
        { type: "result", result: "answer", usage: { input_tokens: 10, output_tokens: 2 } },
      ],
      observations: [
        { id: "span-1", type: "SPAN", name: "[inject] skill", traceId: "trace-1", input: "span", usageDetails: { input: 999, output: 999 } },
        { id: "extract-1", type: "GENERATION", name: "l1-extraction:ai.generateText.doGenerate", traceId: "trace-1", metadata: { protocol: "openai" }, input: "extract", usageDetails: { input: 500, output: 500 } },
        { id: "obs-1", type: "GENERATION", name: "sonnet", metadata: { protocol: "anthropic" }, traceId: "trace-1", startTime: "2026-08-31T00:00:00.100Z", endTime: "2026-08-31T00:00:00.900Z", model: "sonnet", input: { system: "injected", messages: [], tools: [{ name: "skill_view", input_schema: { type: "object" } }] }, output: { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "skill_view", input: { name: "x" } }] }, inputUsage: 12, outputUsage: 3, totalUsage: 20, usageDetails: { input: 10, output: 2, total: 12, input_cached_tokens: 2 } },
      ],
      clickhouseRows: [{ call_id: "toolu_1", initiated_tool: "skill_view", executed_endpoint: "/skill/get-by-name", upstream_status: 200, elapsed_ms: 12 }],
      traceComplete: true,
      langfuseBaseUrl: "http://langfuse",
      langfuseProjectId: "project-a",
    });

    expect(normalized.raw_request?.body).toMatchObject({ system: "raw" });
    expect(normalized.model_calls).toHaveLength(1);
    expect(normalized.model_calls[0]?.thinking).toEqual([{ type: "thinking", thinking: "inspect the available skill" }]);
    expect(normalized.model_calls[0]?.output).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "inspect the available skill" },
        { type: "tool_use", id: "toolu_1", name: "skill_view" },
      ],
    });
    expect(normalized.model_calls[0]?.usage).toMatchObject({ input_tokens: 12, output_tokens: 3, total_tokens: 20, cache_read_input_tokens: 2 });
    expect(normalized.model_calls[0]?.stop_reason).toBe("tool_use");
    expect(normalized.tool_calls).toHaveLength(1);
    expect(normalized.tool_calls[0]).toMatchObject({ logical_name: "skill_view", result: "body", endpoint: "/skill/get-by-name", latency_ms: 12 });
    expect(normalized.final_answer).toBe("answer");
    expect(normalized.usage).toMatchObject({ input_tokens: 12, output_tokens: 3, total_tokens: 20, cache_read_input_tokens: 2 });
    expect(normalized.langfuse_url).toContain("trace-1");
  });

  it("nulls provider-derived metrics when the observation set is incomplete", () => {
    const normalized = normalizeTrace({
      variant: "baseline",
      tapEvents: [],
      clientEvents: [{ type: "result", result: "answer", usage: { input_tokens: 10, output_tokens: 2 } }],
      observations: [],
      clickhouseRows: [],
      traceComplete: false,
      langfuseBaseUrl: "http://langfuse",
      langfuseProjectId: null,
    });
    expect(normalized.usage).toBeNull();
    expect(normalized.model_calls).toEqual([]);
  });
});
