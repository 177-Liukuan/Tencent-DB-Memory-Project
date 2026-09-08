import { isDeepStrictEqual } from "node:util";
import type { ObservationRun } from "../bridge-eval/observations.js";
import { distribution } from "./latency.js";

function statistics(values: number[]) {
  const base = distribution(values);
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - base.mean!) ** 2, 0) / (values.length - 1) : null;
  return { ...base, sample_variance: variance, standard_deviation: variance === null ? null : Math.sqrt(variance) };
}
const change = (b: number | null, n: number | null) => b !== null && b > 0 && n !== null ? (n - b) / b * 100 : null;
function trajectories(runs: ObservationRun[]) {
  const groups = new Map<string, { tools: string[]; count: number }>();
  for (const run of runs) {
    if (run.not_started) continue;
    const key = JSON.stringify(run.actual_tools);
    const group = groups.get(key) ?? { tools: run.actual_tools, count: 0 };
    group.count++; groups.set(key, group);
  }
  return [...groups.values()];
}

/** 延迟是独立实验：不按工具是否选对筛样本，异常则排除整题，两组保持同题、同次数。 */
export function summarizeLatencyStudy(runs: ObservationRun[]) {
  const groups = new Map<string, ObservationRun[]>();
  for (const run of runs.filter(r => r.measurement === "end_to_end")) {
    const key = JSON.stringify([run.suite, run.case_id]);
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  const all = { baseline: [] as number[], native: [] as number[] };
  const tasks = [...groups.values()].map(rows => {
    const expected = rows[0]!.latency_repeats ?? 1;
    const b = rows.filter(r => r.variant === "baseline"), n = rows.filter(r => r.variant === "native");
    let reason = rows.find(r => r.latency_excluded_reason)?.latency_excluded_reason;
    if (!reason && rows.some(r => !r.completed || !r.observation_valid || r.end_to_end_ms === null
      || !Number.isFinite(r.end_to_end_ms) || r.end_to_end_ms < 0)) reason = rows.find(r => r.error)?.error ?? "运行异常或没有完整最终响应";
    if (!reason && rows.some(r => (r.latency_repeats ?? 1) !== expected
      || r.query !== rows[0]!.query || r.seed_version !== rows[0]!.seed_version)) reason = "重复运行的输入、初始资产或次数不一致";
    const repeatIds = (items: ObservationRun[]) => items.map(r => r.repeat ?? 1).sort((x, y) => x - y);
    const planned = Array.from({ length: expected }, (_, i) => i + 1);
    const complete = isDeepStrictEqual(repeatIds(b), planned) && isDeepStrictEqual(repeatIds(n), planned);
    const status = reason ? "excluded" : complete ? "included" : "pending";
    const values = (items: ObservationRun[]) => items.filter(r => r.completed && r.observation_valid
      && typeof r.end_to_end_ms === "number" && Number.isFinite(r.end_to_end_ms) && r.end_to_end_ms >= 0).map(r => r.end_to_end_ms!);
    const bv = values(b), nv = values(n);
    if (status === "included") { all.baseline.push(...bv); all.native.push(...nv); }
    const baseline = statistics(bv), native = statistics(nv);
    return { case_id: rows[0]!.case_id, suite: rows[0]!.suite, query: rows[0]!.query ?? "", tool_family: rows[0]!.tool_family,
      expected_repeats: expected, status, included: status === "included", exclusion_reason: reason ?? null,
      baseline, native, native_change_percent: status === "included" ? change(baseline.mean, native.mean) : null,
      trajectories: { baseline: trajectories(b), native: trajectories(n) },
      run_ids: rows.map(r => r.run_id) };
  });
  const baseline = statistics(all.baseline), native = statistics(all.native);
  return { included_tasks: tasks.filter(t => t.included).length, excluded_tasks: tasks.filter(t => t.status === "excluded").length,
    pending_tasks: tasks.filter(t => t.status === "pending").length, baseline, native,
    native_change_percent: change(baseline.mean, native.mean), tasks,
    boundary: "提交正式 Query 至最终响应；不评价代码正确性。整体方差使用全部正式运行，单位 ms²；未测量不等于零。" };
}
