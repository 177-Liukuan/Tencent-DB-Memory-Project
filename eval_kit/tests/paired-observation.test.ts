import { describe, expect, it } from "vitest";
import { summarizeObservationRuns, type ObservationRun } from "../bridge-eval/observations.js";

const memory = "tdai_memory_search";
const skill = "skill_view";
function run(caseId: string, variant: "baseline" | "native", extra: Partial<ObservationRun> = {}): ObservationRun {
  return { run_id: `${caseId}-${variant}`, case_id: caseId, variant, suite: "main", repeat: 1,
    tool_family: "memory", should_call: true, expected_tools: [memory], allowed_first_tools: [memory],
    observation_valid: true, completed: false, actual_tools: [memory], end_to_end_ms: null, ...extra };
}

describe("同题有效观测配对", () => {
  it("整对排除无效或缺失记录，保留正常无调用和观测后停止，不按是否选对筛选", () => {
    const rows: ObservationRun[] = [];
    for (const id of ["p1", "p2", "p3", "n1", "n2", "p4", "both-invalid"]) {
      for (const variant of ["baseline", "native"] as const) {
        const negative = id.startsWith("n");
        rows.push(run(id, variant, {
          should_call: !negative, expected_tools: negative ? [] : [memory],
          allowed_first_tools: negative ? [] : id === "p4" ? [memory, skill] : [memory],
          observation_valid: !(id === "p3" && variant === "native" || id === "n2" && variant === "baseline" || id === "both-invalid"),
          actual_tools: id === "p2" ? variant === "baseline" ? [] : ["skill_search"]
            : id === "n1" ? variant === "baseline" ? [memory, skill] : []
              : id === "p4" ? variant === "baseline" ? ["skill_search"] : [skill] : [memory],
        }));
      }
    }
    rows.push(run("missing", "baseline"));
    const before = JSON.stringify(rows);
    const result = summarizeObservationRuns(rows);
    const paired = result.paired_comparison;
    expect(paired).toMatchObject({ total_pairs: 8, included_pairs: 4, excluded_pairs: 4 });
    expect(paired.baseline).toMatchObject({ positive_samples: 3, negative_samples: 1, called_positive_samples: 2,
      correct_tool_samples: 1, false_call_samples: 1, effective_call_rate: 2 / 3, tool_selection_accuracy: 1 / 2, false_call_rate: 1 });
    expect(paired.native).toMatchObject({ positive_samples: 3, negative_samples: 1, called_positive_samples: 3,
      correct_tool_samples: 2, effective_call_rate: 1, tool_selection_accuracy: 2 / 3, false_call_rate: 0 });
    expect(paired.baseline.by_tool_family.memory!.false_call_rate).toBe(1);
    expect(paired.baseline.by_tool_family.skill!.false_call_rate).toBe(1);
    expect(paired.baseline.by_task_group.mixed.valid_samples).toBe(1);
    expect(paired.baseline.by_task_group.memory.valid_samples).toBe(2);
    expect(Object.values(paired.native.by_task_group).reduce((n, g) => n + g.valid_samples, 0)).toBe(4);
    expect(result.baseline).toMatchObject({ total_runs: 8, invalid_runs: 2 });
    expect(result.native).toMatchObject({ total_runs: 7, invalid_runs: 2 });
    expect(paired.items.find(p => p.case_id === "missing")).toMatchObject({ included: false, exclusion_reason: "Native 记录缺失" });
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("不同重复轮次和评测分组不能互相补配，空交集的指标为 null", () => {
    const result = summarizeObservationRuns([
      run("x", "baseline"), run("x", "native", { repeat: 2 }), run("x", "native", { suite: "probe" }),
    ]);
    expect(result.paired_comparison).toMatchObject({ total_pairs: 2, included_pairs: 0, excluded_pairs: 2 });
    expect(result.paired_comparison.baseline.effective_call_rate).toBeNull();
    expect(result.by_suite.probe!.paired_comparison.included_pairs).toBe(0);
    expect(summarizeObservationRuns([]).paired_comparison.native.tool_selection_accuracy).toBeNull();
  });

  it("同一题两组的标签不一致时不进行主对比；允许列表的排列不影响配对", () => {
    const mismatch = summarizeObservationRuns([run("x", "baseline"), run("x", "native", { allowed_first_tools: [skill] })]);
    expect(mismatch.paired_comparison.items[0]).toMatchObject({ included: false, exclusion_reason: "两组任务标签不一致" });
    const reordered = summarizeObservationRuns([run("x", "baseline", { allowed_first_tools: [memory, skill] }),
      run("x", "native", { allowed_first_tools: [skill, memory], tool_family: "skill" })]);
    expect(reordered.paired_comparison.included_pairs).toBe(1);
  });

  it("重复的任务/分组/轮次/版本记录报错，不能后写覆盖前写", () => {
    const row = run("x", "baseline");
    expect(() => summarizeObservationRuns([row, { ...row, run_id: "another" }])).toThrow(/Duplicate/);
  });

  it("不同输入或资产版本不能当作同题公平对比", () => {
    for (const extra of [{ query: "另一个问题" }, { seed_version: "另一份初始资产" }]) {
      const result = summarizeObservationRuns([run("x", "baseline"), run("x", "native", extra)]);
      expect(result.paired_comparison.items[0]).toMatchObject({ included: false, exclusion_reason: "两组任务输入或初始资产版本不一致" });
    }
  });
});
