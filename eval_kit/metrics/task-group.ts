import type { EvalCase } from "../types.js";
import { toolFamily } from "./tool.js";

export const TASK_GROUPS = ["memory", "skill", "mixed", "none"] as const;
export type TaskGroup = typeof TASK_GROUPS[number];
type Rules = Pick<EvalCase, "should_call" | "expected_tools" | "allowed_first_tools" | "allowed_sequences" | "expected_tool_sequence">;

// 分组取决于允许的入口，不能用主要需求标签或实际调用反推，避免双入口重复计分。
export function taskGroup(task: Rules): TaskGroup {
  if (!task.should_call) return "none";
  const sequences = task.allowed_sequences ?? (task.expected_tool_sequence?.length ? [task.expected_tool_sequence] : undefined);
  const first = sequences ? sequences.map(sequence => sequence[0] ?? "") : task.allowed_first_tools ?? task.expected_tools;
  const families = new Set(first.map(toolFamily));
  if (!first.length || [...families].some(f => f !== "memory" && f !== "skill")) {
    throw new Error("任务分组需要有效的 Memory / Skill 首次工具列表");
  }
  return families.size === 2 ? "mixed" : families.has("memory") ? "memory" : "skill";
}

export function taskGroupMetrics<T extends Rules>(runs: T[], called: (run: T) => boolean, correct: (run: T) => boolean) {
  const grouped = runs.map(run => ({ run, group: taskGroup(run) }));
  const rate = (n: number, d: number) => d ? n / d : null;
  return Object.fromEntries(TASK_GROUPS.map(group => {
    const selected = grouped.filter(item => item.group === group).map(item => item.run);
    const positive = selected.filter(run => run.should_call);
    const negative = selected.filter(run => !run.should_call);
    const calls = positive.filter(called);
    const correctCount = calls.filter(correct).length;
    const falseCount = negative.filter(called).length;
    return [group, { valid_samples: selected.length, positive_samples: positive.length,
      called_positive_samples: calls.length, correct_tool_samples: correctCount,
      negative_samples: negative.length, false_call_samples: falseCount,
      effective_call_rate: rate(calls.length, positive.length),
      tool_selection_accuracy: rate(correctCount, calls.length), false_call_rate: rate(falseCount, negative.length) }];
  })) as Record<TaskGroup, { valid_samples: number; positive_samples: number; called_positive_samples: number;
    correct_tool_samples: number; negative_samples: number; false_call_samples: number;
    effective_call_rate: number | null; tool_selection_accuracy: number | null; false_call_rate: number | null }>;
}
