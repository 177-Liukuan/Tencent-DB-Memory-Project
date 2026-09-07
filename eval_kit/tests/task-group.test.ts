import { expect, it } from "vitest";
import { taskGroup } from "../metrics/task-group.js";
import { summarizeObservationRuns, type ObservationRun } from "../bridge-eval/observations.js";

const memory = "tdai_memory_search", skill = "skill_view";
it("按允许入口分组，不按主要需求、ID 或序列后续工具分组", () => {
  expect(taskGroup({ should_call: true, expected_tools: [memory], allowed_first_tools: [memory, skill] })).toBe("mixed");
  expect(taskGroup({ should_call: true, expected_tools: [memory, skill], allowed_sequences: [[memory, skill]] })).toBe("memory");
  expect(taskGroup({ should_call: false, expected_tools: [memory, skill] })).toBe("none");
  expect(() => taskGroup({ should_call: true, expected_tools: ["tdai_knowledge_tools_list"] })).toThrow();
  expect(() => taskGroup({ should_call: true, expected_tools: ["unknown"] })).toThrow();
});

it("Mixed 的正确、错误和漏调用单列；None 两类误调用总计一次", () => {
  const row = (id: string, allowed: string[], actual: string[]): ObservationRun => ({
    run_id: id, case_id: id, variant: "native", suite: "main", tool_family: "memory",
    should_call: true, expected_tools: allowed, allowed_first_tools: allowed,
    actual_tools: actual, observation_valid: true, completed: false, end_to_end_ms: null,
  });
  const runs = [row("skill_a", [memory, skill], [memory]), row("memory_b", [memory, skill], [skill]),
    row("c", [memory, skill], ["skill_search", memory]), row("d", [memory, skill], []),
    row("e", [memory], [memory]), row("f", [skill], [skill]),
    { ...row("n", [], [memory, skill]), should_call: false },
    { ...row("bad", [memory, skill], []), observation_valid: false }];
  const result = summarizeObservationRuns(runs).native;
  expect(result).toMatchObject({ valid_samples: 7, effective_call_rate: 5 / 6, tool_selection_accuracy: 4 / 5, false_call_rate: 1 });
  expect(result.by_task_group.mixed).toMatchObject({ valid_samples: 4, positive_samples: 4, called_positive_samples: 3,
    correct_tool_samples: 2, effective_call_rate: .75, tool_selection_accuracy: 2 / 3, false_call_rate: null });
  expect(result.by_task_group.none).toMatchObject({ negative_samples: 1, false_call_samples: 1, effective_call_rate: null, tool_selection_accuracy: null });
  expect(Object.values(result.by_task_group).reduce((n, group) => n + group.valid_samples, 0)).toBe(7);
  expect(result.by_tool_family.memory).toMatchObject({ positive_samples: 1, false_call_rate: 1 });
  expect(result.by_tool_family.skill).toMatchObject({ positive_samples: 1, false_call_rate: 1 });
  expect(summarizeObservationRuns([]).native.by_task_group.mixed.tool_selection_accuracy).toBeNull();
});
