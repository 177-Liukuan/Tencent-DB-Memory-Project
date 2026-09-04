import { describe, expect, it } from "vitest";

import { scoreRun, summarizeRuns } from "../metrics/index.js";
import { percentile } from "../metrics/latency.js";
import { evaluateArgument } from "../metrics/tool.js";
import type { CaseRun, EvalCase } from "../types.js";

function evalCase(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    schema_version: 1,
    case_id: "case-a",
    suite: "smoke",
    query: "find memory",
    should_call: true,
    expected_tools: ["tdai_memory_search"],
    ...overrides,
  };
}

function run(overrides: Partial<CaseRun> = {}): CaseRun {
  return {
    schema_version: 1,
    run_id: "run-a",
    experiment_id: "exp-a",
    case_id: "case-a",
    variant: "baseline",
    session_id: "session-a",
    identity: { service_id: "service-a", team_id: "team-a", agent_id: "agent-a", task_id: "task-a" },
    case: { suite: "smoke", query: "find memory", should_call: true, expected_tools: ["tdai_memory_search"], argument_assertions: [], answer_assertions: [] },
    status: "completed",
    started_at: "2026-08-31T00:00:00.000Z",
    ended_at: "2026-08-31T00:00:01.000Z",
    raw_request: null,
    model_calls: [],
    tool_calls: [],
    final_answer: "done",
    usage: { provider: null, definition_tokens: null },
    latency: { end_to_end_ms: 1000, ttft_ms: 200, tool_ms: [] },
    trace: { complete: true, langfuse_url: null, artifacts: {} },
    metrics: null,
    failure_tags: [],
    ...overrides,
  };
}

describe("metric engine", () => {
  it("scores missing, false-positive, wrong, extra, arguments and task failures", () => {
    expect(scoreRun(evalCase(), run()).failure_tags).toContain("Missing Tool");
    expect(scoreRun(evalCase({ should_call: false, expected_tools: [] }), run({ tool_calls: [{ call_id: "1", raw_name: "skill_view", logical_name: "skill_view", kind: "managed", arguments: {}, result: null, error: null, started_at: null, ended_at: null, latency_ms: null }] })).failure_tags).toContain("False Positive");

    const wrong = run({ tool_calls: [{ call_id: "2", raw_name: "skill_view", logical_name: "skill_view", kind: "managed", arguments: {}, result: null, error: null, started_at: null, ended_at: null, latency_ms: null }] });
    expect(scoreRun(evalCase(), wrong).failure_tags).toContain("Wrong Tool");

    const extra = run({ tool_calls: [
      { call_id: "3", raw_name: "tdai_memory_search", logical_name: "tdai_memory_search", kind: "managed", arguments: {}, result: null, error: null, started_at: null, ended_at: null, latency_ms: null },
      { call_id: "4", raw_name: "skill_view", logical_name: "skill_view", kind: "managed", arguments: {}, result: null, error: null, started_at: null, ended_at: null, latency_ms: null },
    ] });
    expect(scoreRun(evalCase(), extra).failure_tags).toContain("Extra Tool");
  });

  it("uses unique tool sets for micro precision/recall and reports duplicate calls", () => {
    const scoredA = scoreRun(evalCase(), run({
      tool_calls: [
        { call_id: "1", raw_name: "tdai_memory_search", logical_name: "tdai_memory_search", kind: "managed", arguments: {}, result: null, error: null, started_at: null, ended_at: null, latency_ms: null },
        { call_id: "2", raw_name: "tdai_memory_search", logical_name: "tdai_memory_search", kind: "managed", arguments: {}, result: null, error: null, started_at: null, ended_at: null, latency_ms: null },
      ],
    }));
    const scoredB = scoreRun(evalCase({ case_id: "case-b", expected_tools: ["skill_view"] }), run({ run_id: "run-b", case_id: "case-b" }));
    const summary = summarizeRuns([
      { ...run(), metrics: scoredA.metrics, failure_tags: scoredA.failure_tags },
      { ...run({ run_id: "run-b", case_id: "case-b" }), metrics: scoredB.metrics, failure_tags: scoredB.failure_tags },
    ]);

    expect(summary.overall.tool_micro_precision).toBe(1);
    expect(summary.overall.tool_micro_recall).toBe(0.5);
    expect(summary.overall.duplicate_tool_calls).toBe(1);
  });

  it("evaluates deterministic answer assertions and makes unlabelled task pass null", () => {
    const exact = scoreRun(evalCase({ answer_assertions: [{ operator: "exact", value: "323" }] }), run({ final_answer: " 323 " }));
    expect(exact.metrics?.task_pass).toBe(true);
    expect(exact.metrics?.case_pass).toBe(false);
    expect(scoreRun(evalCase(), run()).metrics?.task_pass).toBeNull();
  });
});

describe("percentile", () => {
  it("uses nearest-rank P95", () => {
    expect(percentile([1, 2, 3, 4, 100], 0.95)).toBe(100);
    expect(percentile([], 0.95)).toBeNull();
  });
});

describe("argument assertions", () => {
  it("compares object values independent of key insertion order", () => {
    expect(evaluateArgument(
      { path: "filters", operator: "equals", value: { owner: "a", limit: 5 } },
      { filters: { limit: 5, owner: "a" } },
    )).toBe(true);
  });
});
