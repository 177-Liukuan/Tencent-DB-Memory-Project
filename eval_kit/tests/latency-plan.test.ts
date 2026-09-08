import { expect, it } from "vitest";
import { createLatencyPlan, orderLatencyRuns } from "../pipeline/latency-plan.js";
import type { EvalCase } from "../types.js";
import type { PreparedRun } from "../bridge-eval/config.js";

const cases = ["memory", "skill", "none"].flatMap(f => Array.from({length: 4}, (_, i) => ({
  schema_version: 1, case_id: `${f}-${i}`, suite: "main", query: "任务", tool_family: f,
  should_call: f !== "none", expected_tools: f === "none" ? [] : [f === "memory" ? "tdai_memory_search" : "skill_view"],
  asset_path: "project",
}))) as EvalCase[];

it("按2/2/1抽样且预先固定备用顺序，不按运行结果挑选；耗尽时不重复使用旧题", () => {
  const a = createLatencyPlan(cases, "seed"), b = createLatencyPlan([...cases].reverse(), "seed");
  expect(a.selected.map(c => c.tool_family)).toEqual(["memory", "memory", "skill", "skill", "none"]);
  expect(a.selected).toEqual(b.selected);
  const first = a.nextReplacement(a.selected[0]!);
  expect(first).toEqual(b.nextReplacement(b.selected[0]!));
  expect(first!.tool_family).toBe("memory");
  expect(a.selected.some(c => c.case_id === first!.case_id)).toBe(false);
  expect(a.nextReplacement(first!)).not.toBeNull();
  expect(a.nextReplacement(first!)).toBeNull();
});

it("每题重复5次，每对相邻执行，配对先后顺序由seed决定且可重现", () => {
  const runs = Array.from({length:5}, (_, i) => ["baseline", "native"].map(v => ({case_id:"a",repeat:i+1,variant:v,run_id:`${v}-${i}`}))).flat() as PreparedRun[];
  const ordered = orderLatencyRuns(runs,"seed");
  expect(ordered).toHaveLength(10);
  expect(orderLatencyRuns([...runs].reverse(),"seed")).toEqual(ordered);
  for(let i=0;i<10;i+=2){
    expect(ordered[i]!.repeat).toBe(ordered[i+1]!.repeat);
    expect(ordered[i]!.variant).not.toBe(ordered[i+1]!.variant);
  }
});
