import { describe, expect, it } from "vitest";

import { aggregateRuns, pairedDeltas, scoreRun, summarizeRuns } from "../metrics/index.js";
import { distribution, percentile } from "../metrics/latency.js";
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

function calls(...names: string[]): CaseRun["tool_calls"] {
  return names.map((name, index) => ({
    call_id: String(index), raw_name: name, logical_name: name, kind: "managed",
    arguments: {}, result: null, error: null, started_at: null, ended_at: null, latency_ms: null,
  }));
}

describe("metric engine", () => {
  it("旧评分入口同样将双入口独立统计，不改变总体选择正确率", () => {
    const task = evalCase({ tool_family: "memory", allowed_first_tools: ["tdai_memory_search", "skill_view"] });
    const results = ["tdai_memory_search", "skill_view", "skill_search"].map(name => scoreRun(task, run({ tool_calls: calls(name) })));
    const summary = aggregateRuns(results);
    expect(summary.tool_selection_accuracy).toBe(2 / 3);
    expect(summary.by_task_group.mixed).toMatchObject({ positive_samples: 3, correct_tool_samples: 2 });
    expect(summary.by_tool_family.memory.positive_cases).toBe(0);
    expect(summary.by_tool_family.skill.positive_cases).toBe(0);
  });
  it("accepts an allowed first tool without requiring every alternative", () => {
    const testCase = evalCase({ expected_tools: ["tdai_memory_search", "tdai_conversation_search"], allowed_first_tools: ["tdai_memory_search", "tdai_conversation_search"] });
    const good = scoreRun(testCase, run({ tool_calls: calls("tdai_conversation_search") }));
    expect(good.metrics?.selection_correct).toBe(true);
    expect(good.metrics?.case_pass).toBe(true);
    const corrected = scoreRun(testCase, run({ tool_calls: calls("skill_view", "tdai_memory_search") }));
    expect(corrected.metrics?.effective_call).toBe(true);
    expect(corrected.metrics?.selection_correct).toBe(false);
  });

  it("checks the first call for single-step labels and preserves sequence order and repetitions", () => {
    expect(scoreRun(evalCase(), run({ tool_calls: calls("tdai_memory_search", "skill_view") })).metrics?.selection_correct).toBe(true);
    const sequence = evalCase({ expected_tools: ["skill_search", "skill_view"], expected_tool_sequence: ["skill_search", "skill_view"] });
    expect(scoreRun(sequence, run({ tool_calls: calls("skill_view", "skill_search") })).metrics?.selection_correct).toBe(false);
    expect(scoreRun(sequence, run({ tool_calls: calls("skill_search", "skill_view") })).metrics?.selection_correct).toBe(true);
    expect(scoreRun(sequence, run({ tool_calls: calls("skill_search", "skill_search", "skill_view") })).metrics?.selection_correct).toBe(false);
    const alternatives = evalCase({ expected_tools: ["skill_search", "skill_view"], allowed_sequences: [["skill_view"], ["skill_search", "skill_view"]] });
    expect(scoreRun(alternatives, run({ tool_calls: calls("skill_view") })).metrics?.selection_correct).toBe(true);
  });

  it("counts repeated observations of a call ID once, but keeps new calls to the same tool", () => {
    const [one] = calls("tdai_memory_search");
    const scored = scoreRun(evalCase(), run({ tool_calls: [one!, one!, { ...one!, call_id: "new-call" }] }));
    expect(scored.metrics?.managed_tool_calls).toBe(2);
    expect(scored.metrics?.duplicate_tool_calls).toBe(1);
  });

  it("separates expected task family from the called family and shares negative denominators", () => {
    const score = (id: string, family: "memory" | "skill" | "none", names: string[]) => scoreRun(
      evalCase({ case_id: id, tool_family: family, should_call: family !== "none", expected_tools: family === "none" ? [] : [family === "memory" ? "tdai_memory_search" : "skill_view"] }),
      run({ run_id: id, case_id: id, tool_calls: calls(...names) }),
    );
    const summary = summarizeRuns([
      score("m1", "memory", ["skill_view"]), score("m2", "memory", []),
      score("s", "skill", ["skill_view"]),
      score("n1", "none", ["skill_view", "tdai_memory_search"]), score("n2", "none", []),
    ]);
    expect(summary.overall.effective_call_rate).toBeCloseTo(2 / 3);
    expect(summary.overall.tool_selection_accuracy).toBe(0.5);
    expect(summary.overall.false_call_rate).toBe(0.5);
    expect(summary.variants.baseline?.by_tool_family.memory).toMatchObject({ positive_cases: 2, called_positive_cases: 1, correct_tool_cases: 0, negative_cases: 2, false_call_cases: 1, effective_call_rate: 0.5, false_call_rate: 0.5, tool_selection_accuracy: 0 });
    expect(summary.overall.by_tool_family.skill.effective_call_rate).toBe(1);
    expect(summary.overall.by_tool_family.skill.false_call_rate).toBe(0.5);
  });

  it("excludes failed timing and averages repetitions within each case before combining cases", () => {
    const make = (id: string, caseId: string, ms: number, status: CaseRun["status"] = "completed") => run({ run_id: id, case_id: caseId, status, latency: { end_to_end_ms: ms, ttft_ms: 1, tool_ms: [] } });
    const items = [make("a1", "a", 100), make("a2", "a", 300), make("b1", "b", 1000), make("bad", "c", 1, "timeout")];
    expect(aggregateRuns(items).end_to_end_ms).toEqual({ count: 2, mean: 600, median: 600, p95: 1000 });
  });

  it("uses all repetitions in paired deltas and reports percentage changes over the same case set", () => {
    const make = (caseId: string, variant: CaseRun["variant"], ms: number) => run({ case_id: caseId, variant, latency: { end_to_end_ms: ms, ttft_ms: 1, tool_ms: [] } });
    const items = [make("a", "baseline", 100), make("a", "baseline", 300), make("a", "native", 100), make("b", "baseline", 1000), make("b", "native", 800), make("unpaired", "baseline", 9999)];
    expect(pairedDeltas(items).end_to_end_ms).toEqual({ count: 2, mean: -150, median: -150, p95: -100 });
    expect(summarizeRuns(items).end_to_end_comparison).toMatchObject({ paired_cases: 2, baseline_mean_ms: 600, native_mean_ms: 450, change_percent: -25 });
  });

  it("keeps main and probe summaries separate for the formal report", () => {
    const main = scoreRun(evalCase(), run({ tool_calls: calls("tdai_memory_search"), case: { ...run().case, suite: "main" } }));
    const probe = scoreRun(evalCase(), run({ case: { ...run().case, suite: "probe" } }));
    expect(summarizeRuns([main, probe]).suites.main?.variants.baseline?.effective_call_rate).toBe(1);
    expect(summarizeRuns([main, probe]).suites.probe?.variants.baseline?.effective_call_rate).toBe(0);
  });
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
  it("uses the average of the two middle observations for an even-sized median", () => {
    expect(distribution([10, 20, 30, 100]).median).toBe(25);
  });
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
