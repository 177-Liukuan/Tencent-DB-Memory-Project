import { createHash } from "node:crypto";
import { taskGroup } from "../metrics/task-group.js";
import type { EvalCase } from "../types.js";
import type { PreparedRun } from "../bridge-eval/config.js";

export const DEFAULT_LATENCY = { tasks: { memory: 2, skill: 2, none: 1 }, repeats: 5, max_replacements: 5 };
const rank = (seed: string, key: string) => createHash("sha256").update(`${seed}:${key}`).digest("hex");

/** 先冻结随机顺序，再运行；双入口题不混入这次约定的三类小样本。 */
export function createLatencyPlan(cases: EvalCase[], seed: string, counts = DEFAULT_LATENCY.tasks) {
  const selected: EvalCase[] = [], reserves = new Map<string, EvalCase[]>();
  for (const family of ["memory", "skill", "none"] as const) {
    const ordered = cases.filter(c => c.suite === "main" && c.asset_path && taskGroup(c) === family)
      .sort((a, b) => rank(seed, a.case_id).localeCompare(rank(seed, b.case_id)));
    if (ordered.length < counts[family]) throw new Error(`${family} 延迟任务不足 ${counts[family]} 道`);
    selected.push(...ordered.slice(0, counts[family])); reserves.set(family, ordered.slice(counts[family]));
  }
  const replacementOrder = Object.fromEntries([...reserves].map(([f, tasks]) => [f, tasks.map(t => t.case_id)]));
  return { selected, replacementOrder, nextReplacement: (failed: EvalCase) => reserves.get(taskGroup(failed))?.shift() ?? null };
}

export function orderLatencyRuns(runs: PreparedRun[], seed: string): PreparedRun[] {
  return [...runs].sort((a, b) => a.case_id.localeCompare(b.case_id) || a.repeat - b.repeat ||
    (rank(seed, `${a.case_id}:${a.repeat}`).charCodeAt(0) % 2 ? -1 : 1) * a.variant.localeCompare(b.variant));
}
