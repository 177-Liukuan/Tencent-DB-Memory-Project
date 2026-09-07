import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { selectionCorrect, toolFamily } from "../metrics/tool.js";
import { distribution } from "../metrics/latency.js";
import { taskGroup, taskGroupMetrics } from "../metrics/task-group.js";
import type { EvalCase, Variant } from "../types.js";

const eventSchema = z.object({
  event_id: z.string().min(1), session_id: z.string().min(1), tool_name: z.string().min(1),
  tool_family: z.enum(["memory", "skill"]), timestamp: z.string().datetime(),
  call_id: z.string().min(1).nullable(),
}).strict();
export type BridgeEvent = z.infer<typeof eventSchema>;
export function normalizeBridgeEvents(raw: unknown[], sessionId: string, variant: Variant): BridgeEvent[] {
  const seenEvents = new Map<string, string>();
  const calls = new Map<string, string>();
  const result: BridgeEvent[] = [];
  for (const row of raw) {
    const event = eventSchema.parse(row);
    if (event.session_id !== sessionId || toolFamily(event.tool_name) !== event.tool_family) throw new Error("Invalid observation session or tool family");
    const serialized = JSON.stringify(event);
    if (seenEvents.has(event.event_id)) {
      if (seenEvents.get(event.event_id) !== serialized) throw new Error("Conflicting event ID");
      continue;
    }
    seenEvents.set(event.event_id, serialized);
    // 只对 Native 明确提供的 callId 去重，不能把同名调用或 Baseline 的多次 HTTP 请求合并。
    if (variant === "native" && event.call_id) {
      const existing = calls.get(event.call_id);
      if (existing && existing !== event.tool_name) throw new Error("Conflicting call ID");
      if (existing) continue;
      calls.set(event.call_id, event.tool_name);
    }
    result.push(event);
  }
  return result;
}

export type ObservationRun = {
  run_id: string; case_id: string; variant: Variant; suite: EvalCase["suite"]; tool_family: NonNullable<EvalCase["tool_family"]>;
  should_call: boolean; expected_tools: string[];
  allowed_first_tools?: string[]; expected_tool_sequence?: string[]; allowed_sequences?: string[][];
  observation_valid: boolean; completed: boolean; actual_tools: string[]; end_to_end_ms: number | null;
  repeat?: number;
  error?: string | undefined;
  query?: string;
  seed_version?: string;
};
const rate = (n: number, d: number) => d === 0 ? null : n / d;

function selectionRule(run: ObservationRun) {
  if (!run.should_call) return { should_call: false };
  const sequences = run.allowed_sequences ?? (run.expected_tool_sequence?.length ? [run.expected_tool_sequence] : null);
  // 列表排列不改变允许集合；序列内部的先后关系则必须保留。
  return { should_call: true, rule: sequences ? { sequences: sequences.map(s => JSON.stringify(s)).sort() }
    : run.allowed_first_tools ? { first: [...run.allowed_first_tools].sort() } : { expected: [...run.expected_tools].sort() } };
}

function invalidReason(run: ObservationRun | undefined, name: string) {
  if (!run) return `${name} 记录缺失`;
  if (run.observation_valid) return null;
  if (/initialization|session init/i.test(run.error ?? "")) return `${name} 初始化失败`;
  if (/timeout|timed out/i.test(run.error ?? "")) return `${name} 超时，观测无效`;
  return `${name} 观测无效`;
}

function observationPairs(runs: ObservationRun[]) {
  const pairs = new Map<string, { suite: ObservationRun["suite"]; case_id: string; repeat: number;
    baseline?: ObservationRun; native?: ObservationRun }>();
  for (const run of runs) {
    const key = JSON.stringify([run.suite, run.case_id, run.repeat ?? 1]);
    const pair = pairs.get(key) ?? { suite: run.suite, case_id: run.case_id, repeat: run.repeat ?? 1 };
    if (pair[run.variant]) throw new Error(`Duplicate observation pair: ${run.run_id}`);
    pair[run.variant] = run;
    pairs.set(key, pair);
  }
  return [...pairs.values()].map(pair => {
    const { baseline: b, native: n } = pair;
    const reasons = [invalidReason(b, "Baseline"), invalidReason(n, "Native")].filter(Boolean);
    if (b && n) {
      if (!isDeepStrictEqual(selectionRule(b), selectionRule(n))) reasons.push("两组任务标签不一致");
      if (b.query !== n.query || b.seed_version !== n.seed_version) reasons.push("两组任务输入或初始资产版本不一致");
    }
    // 配对只依据观测是否有效及输入是否一致，不能按调用、正确性或最终 Coding 完成情况筛题。
    return { ...pair, included: reasons.length === 0, exclusion_reason: reasons.length ? reasons.join("；") : null };
  });
}

function aggregate(runs: ObservationRun[]) {
  const valid = runs.filter(r => r.observation_valid);
  const positive = valid.filter(r => r.should_call);
  const negative = valid.filter(r => !r.should_call);
  const called = positive.filter(r => r.actual_tools.length > 0);
  const correct = (r: ObservationRun) => selectionCorrect({ schema_version: 1, query: "", ...r }, r.actual_tools);
  const byToolFamily = Object.fromEntries(["memory", "skill"].map(family => {
    const p = positive.filter(r => taskGroup(r) === family);
    const calledFamily = p.filter(r => r.actual_tools.length > 0);
    return [family, {
      positive_samples: p.length, called_positive_samples: calledFamily.length,
      negative_samples: negative.length,
      false_call_samples: negative.filter(r => r.actual_tools.some(n => toolFamily(n) === family)).length,
      effective_call_rate: rate(calledFamily.length, p.length),
      false_call_rate: rate(negative.filter(r => r.actual_tools.some(n => toolFamily(n) === family)).length, negative.length),
      tool_selection_accuracy: rate(calledFamily.filter(correct).length, calledFamily.length),
    }];
  }));
  // 同一案例多次运行先取均值，避免重复次数多的案例主导端到端延迟。
  const latencyByCase = new Map<string, number[]>();
  for (const r of valid) if (r.completed && r.end_to_end_ms !== null) {
    const values = latencyByCase.get(r.case_id) ?? []; values.push(r.end_to_end_ms); latencyByCase.set(r.case_id, values);
  }
  return {
    total_runs: runs.length, invalid_runs: runs.length - valid.length, valid_samples: valid.length,
    completed_runs:runs.filter(r=>r.completed).length,incomplete_runs:runs.filter(r=>!r.completed).length,
    positive_samples: positive.length, negative_samples: negative.length, called_positive_samples: called.length,
    correct_tool_samples: called.filter(correct).length,
    false_call_samples: negative.filter(r => r.actual_tools.length > 0).length,
    effective_call_rate: rate(called.length, positive.length),
    false_call_rate: rate(negative.filter(r => r.actual_tools.length > 0).length, negative.length),
    tool_selection_accuracy: rate(called.filter(correct).length, called.length),
    by_tool_family: byToolFamily,
    by_task_group: taskGroupMetrics(valid, r => r.actual_tools.length > 0, correct),
    end_to_end_ms: distribution([...latencyByCase.values()].map(values => values.reduce((a, b) => a + b, 0) / values.length)),
  };
}

export function summarizeObservationRuns(runs: ObservationRun[]) {
  const variants = (items: ObservationRun[]) => ({
    baseline: aggregate(items.filter(r => r.variant === "baseline")),
    native: aggregate(items.filter(r => r.variant === "native")),
  });
  const compare = (items: ObservationRun[]) => {
    const pairs = observationPairs(items);
    const included = pairs.filter(p => p.included);
    return { total_pairs: pairs.length, included_pairs: included.length, excluded_pairs: pairs.length - included.length,
      ...variants(included.flatMap(p => [p.baseline!, p.native!])),
      items: pairs.map(({ baseline: _b, native: _n, ...pair }) => pair) };
  };
  // 主评测与探针/冒烟分开，不能为了凑样本把不同用途的数据混入主指标。
  const suite = runs.some(r => r.suite === "main") ? "main" : runs[0]?.suite ?? "main";
  const selected = runs.filter(r => r.suite === suite);
  const complete = observationPairs(selected).filter(p => p.included && p.baseline!.completed && p.native!.completed
    && p.baseline!.end_to_end_ms !== null && p.native!.end_to_end_ms !== null);
  const pairedByCase = new Map<string, { baseline: number[]; native: number[] }>();
  for (const p of complete) {
    const value = pairedByCase.get(p.baseline!.case_id) ?? { baseline: [], native: [] };
    value.baseline.push(p.baseline!.end_to_end_ms!); value.native.push(p.native!.end_to_end_ms!);
    pairedByCase.set(p.baseline!.case_id, value);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const b = distribution([...pairedByCase.values()].map(p => mean(p.baseline))).mean;
  const n = distribution([...pairedByCase.values()].map(p => mean(p.native))).mean;
  return {
    // 保留原有各组统计作为参考；主对比明确使用 paired_comparison，避免混淆两个统计范围。
    schema_version: 2, metric_suite: suite, primary_scope: "paired_valid", ...variants(selected),
    paired_comparison: compare(selected),
    by_suite: Object.fromEntries([...new Set(runs.map(r => r.suite))].map(s => {
      const items = runs.filter(r => r.suite === s);
      return [s, { ...variants(items), paired_comparison: compare(items) }];
    })),
    paired_latency: { pairs: complete.length, cases: pairedByCase.size, baseline_mean_ms: b, native_mean_ms: n,
      native_change_percent: b !== null && b > 0 && n !== null ? (n - b) / b * 100 : null },
    observation_boundary: "Requests received by Memory/Skill Bridge; order is Bridge arrival order",
  };
}
