import { expect, it } from "vitest";
import { summarizeLatencyStudy } from "../metrics/latency-study.js";
import { summarizeObservationRuns, type ObservationRun } from "../bridge-eval/observations.js";

function run(caseId: string, variant: "baseline" | "native", repeat: number, ms: number | null): ObservationRun {
  return { run_id: `${caseId}-${variant}-${repeat}`, case_id: caseId, variant, repeat, suite: "main",
    tool_family: "memory", query: "任务", seed_version: "frozen", should_call: true, expected_tools: ["tdai_memory_search"],
    measurement: "end_to_end", latency_repeats: 2, observation_valid: true, completed: ms !== null,
    actual_tools: ["tdai_memory_search"], end_to_end_ms: ms };
}

it("整体方差来自全部运行，不是任务均值的方差；任务与总体变化率分别计算", () => {
  const rows = [run("a", "baseline", 1, 1000), run("a", "native", 1, 2000),
    run("a", "baseline", 2, 3000), run("a", "native", 2, 4000),
    run("b", "baseline", 1, 5000), run("b", "native", 1, 6000),
    run("b", "baseline", 2, 7000), run("b", "native", 2, 8000)];
  const result = summarizeLatencyStudy(rows);
  expect(result.baseline).toMatchObject({ count: 4, mean: 4000, sample_variance: 20_000_000 / 3 });
  expect(result.baseline.standard_deviation).toBeCloseTo(Math.sqrt(20_000_000 / 3));
  expect(result.native.mean).toBe(5000);
  expect(result.native_change_percent).toBe(25);
  expect(result.tasks[0]).toMatchObject({ included: true, baseline: { count: 2, mean: 2000, sample_variance: 2_000_000 }, native_change_percent: 50 });
  expect(result.tasks[0]!.trajectories.baseline).toEqual([{ tools: ["tdai_memory_search"], count: 2 }]);
});

it("一侧超时整题退出汇总；未跑满重复次数不提前纳入，工具选择标签不影响延迟", () => {
  const failed = [run("a", "baseline", 1, 1000), run("a", "native", 1, 2000),
    run("a", "baseline", 2, 3000), { ...run("a", "native", 2, null), error: "Claude timed out" }];
  const pending = [run("b", "baseline", 1, 500), run("b", "native", 1, 600)];
  const result = summarizeLatencyStudy([...failed, ...pending]);
  expect(result.baseline.count).toBe(0);
  expect(result.baseline.sample_variance).toBeNull();
  expect(result.tasks.map(t => t.status)).toEqual(["excluded", "pending"]);
  const noChecks = [run("c", "baseline", 1, 100), { ...run("c", "native", 1, 200), actual_tools: [] }]
    .map(r => ({ ...r, latency_repeats: 1 }));
  expect(summarizeLatencyStudy(noChecks).included_tasks).toBe(1);
  expect(summarizeLatencyStudy(noChecks).baseline.sample_variance).toBeNull();
});

it("延迟重复运行不混入工具调用指标；旧工具观测仍保留原公式", () => {
  const main = { ...run("main", "baseline", 1, null), measurement: "tool_calls" as const, completed: false };
  const latency = [run("latency", "baseline", 1, 100), run("latency", "native", 1, 200)]
    .map(r => ({ ...r, latency_repeats: 1 }));
  const summary = summarizeObservationRuns([main, ...latency]);
  expect(summary.baseline.total_runs).toBe(1);
  expect(summary.native.total_runs).toBe(0);
  expect(summary.latency_study.baseline.count).toBe(1);
  expect(summary.latency_study.native.mean).toBe(200);
});
