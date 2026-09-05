import type { AggregateMetrics, CaseRun, EvalCase, FailureTag, ToolFamilyMetrics } from "../types.js";
import { distribution } from "./latency.js";
import { scoreTask } from "./task.js";
import { assertionsForCall, evaluateArgument, selectionCorrect, toolFamily } from "./tool.js";
import { summarizeStaticDefinitions } from "./token.js";

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function scoreRun(testCase: EvalCase, source: CaseRun): CaseRun {
  // 同一个调用可能同时出现在客户端记录与 Langfuse 中；新的 ID 才是新调用。
  const managed = [...new Map(source.tool_calls.filter((call) => call.kind === "managed").map((call) => [call.call_id, call])).values()];
  const expected = [...new Set(testCase.expected_tools)];
  const actual = [...new Set(managed.map((call) => call.logical_name))];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const intersection = actual.filter((name) => expectedSet.has(name));
  const falsePositives = actual.filter((name) => !expectedSet.has(name));
  const falseNegatives = expected.filter((name) => !actualSet.has(name));
  const selectedCorrectly = testCase.should_call && managed.length > 0
    ? selectionCorrect(testCase, managed.map((call) => call.logical_name)) : null;
  const tags = new Set<FailureTag>();

  if (source.status === "timeout") tags.add("Timeout");
  if (source.status === "infra_error") tags.add("Infra Error");
  if (!source.trace.complete) tags.add("Trace Incomplete");
  if (testCase.should_call && managed.length === 0) tags.add("Missing Tool");
  if (!testCase.should_call && managed.length > 0) tags.add("False Positive");
  if (selectedCorrectly === false) tags.add("Wrong Tool");
  if (testCase.should_call && falsePositives.length > 0) tags.add("Extra Tool");
  if (managed.some((call) => call.error)) tags.add("Tool Error");

  let argumentCorrectCalls = 0;
  let argumentEvaluatedCalls = 0;
  for (const call of managed.filter((item) => expectedSet.has(item.logical_name))) {
    const assertions = assertionsForCall(testCase.argument_assertions, call);
    if (assertions.length === 0) continue;
    argumentEvaluatedCalls += 1;
    if (assertions.every((assertion) => evaluateArgument(assertion, call.arguments))) argumentCorrectCalls += 1;
  }
  const argumentPass = argumentEvaluatedCalls === 0 ? null : argumentCorrectCalls === argumentEvaluatedCalls;
  if (argumentPass === false) tags.add("Invalid Arguments");

  const taskPass = scoreTask(testCase, source.final_answer);
  if (taskPass === false) tags.add("Task Mismatch");
  const toolBehaviorPass = testCase.should_call
    ? selectedCorrectly === true && falsePositives.length === 0 && argumentPass !== false && !managed.some((call) => call.error)
    : managed.length === 0;
  const runComplete = source.status === "completed" && source.trace.complete;
  const casePass = runComplete && toolBehaviorPass && taskPass !== false;
  const families = new Set(expected.map(toolFamily).filter((family) => family !== null));
  const family = testCase.tool_family ?? (!testCase.should_call ? "none" : families.size === 1 ? [...families][0] : undefined);

  return {
    ...source,
    case: {
      ...source.case, should_call: testCase.should_call, expected_tools: expected,
      ...(testCase.allowed_first_tools ? { allowed_first_tools: testCase.allowed_first_tools } : {}),
      ...(testCase.expected_tool_sequence ? { expected_tool_sequence: testCase.expected_tool_sequence } : {}),
      ...(testCase.allowed_sequences ? { allowed_sequences: testCase.allowed_sequences } : {}),
    },
    ...(family ? { tool_family: family } : {}),
    ...(testCase.difficulty ? { difficulty: testCase.difficulty } : {}),
    ...(testCase.tags ? { tags: testCase.tags } : {}),
    metrics: {
      expected_tools: expected,
      actual_tools: actual,
      tool_true_positives: intersection.length,
      tool_false_positives: falsePositives.length,
      tool_false_negatives: falseNegatives.length,
      managed_tool_calls: managed.length,
      duplicate_tool_calls: Math.max(0, managed.length - actual.length),
      effective_call: testCase.should_call ? managed.length > 0 : null,
      false_call: testCase.should_call ? null : managed.length > 0,
      selection_correct: selectedCorrectly,
      argument_pass: argumentPass,
      argument_correct_calls: argumentCorrectCalls,
      argument_evaluated_calls: argumentEvaluatedCalls,
      task_pass: taskPass,
      case_pass: casePass,
      llm_calls: source.model_calls.length,
      tool_calls: managed.length,
      internal_reentry_rounds: Math.max(0, source.model_calls.length - Math.max(1, source.trace.client_request_count ?? 1)),
    },
    failure_tags: [...tags],
  };
}

function usableRun(run: CaseRun): boolean {
  return run.status === "completed" && run.trace.complete;
}

function familyMetrics(runs: CaseRun[], family: "memory" | "skill"): ToolFamilyMetrics {
  // 按任务预期分正样本；两类误调用率共用全部负样本，不能只筛 tool_family。
  const positives = runs.filter((run) => run.metrics?.effective_call !== null && run.metrics?.effective_call !== undefined
    && (run.tool_family === family || (!run.tool_family && run.metrics.expected_tools.every((name) => toolFamily(name) === family))));
  const negatives = runs.filter((run) => run.metrics?.false_call !== null && run.metrics?.false_call !== undefined);
  const called = positives.filter((run) => run.metrics?.effective_call).length;
  const correct = positives.filter((run) => run.metrics?.selection_correct).length;
  const falseCalls = negatives.filter((run) => run.metrics?.actual_tools.some((name) => toolFamily(name) === family)).length;
  return {
    positive_cases: positives.length, called_positive_cases: called, correct_tool_cases: correct,
    negative_cases: negatives.length, false_call_cases: falseCalls,
    effective_call_rate: ratio(called, positives.length), false_call_rate: ratio(falseCalls, negatives.length),
    tool_selection_accuracy: ratio(correct, called),
  };
}

function caseLatencies(runs: CaseRun[]): number[] {
  const cases = new Map<string, number[]>();
  for (const run of runs) {
    const value = run.latency.end_to_end_ms;
    if (!usableRun(run) || value === null || !Number.isFinite(value) || value < 0) continue;
    const key = JSON.stringify([run.experiment_id, run.case_id, run.variant]);
    const values = cases.get(key) ?? [];
    values.push(value);
    cases.set(key, values);
  }
  // 每道题先平均多次运行，再跨题汇总，防止重复次数不同改变题目权重。
  return [...cases.values()].map((values) => distribution(values).mean!);
}

export function aggregateRuns(runs: CaseRun[]): AggregateMetrics {
  const usable = runs.filter(usableRun);
  const metrics = usable.flatMap((run) => run.metrics ? [run.metrics] : []);
  const taskEvaluated = metrics.filter((metric) => metric.task_pass !== null);
  const effectiveEvaluated = metrics.filter((metric) => metric.effective_call !== null);
  const falseCallEvaluated = metrics.filter((metric) => metric.false_call !== null);
  const selectionEvaluated = metrics.filter((metric) => metric.selection_correct !== null);
  const tp = metrics.reduce((sum, metric) => sum + metric.tool_true_positives, 0);
  const fp = metrics.reduce((sum, metric) => sum + metric.tool_false_positives, 0);
  const fn = metrics.reduce((sum, metric) => sum + metric.tool_false_negatives, 0);
  const argGood = metrics.reduce((sum, metric) => sum + metric.argument_correct_calls, 0);
  const argTotal = metrics.reduce((sum, metric) => sum + metric.argument_evaluated_calls, 0);
  return {
    runs: runs.length,
    completed_runs: runs.filter((run) => run.status === "completed").length,
    trace_complete_runs: runs.filter((run) => run.status === "completed" && run.trace.complete).length,
    case_pass_rate: ratio(metrics.filter((metric) => metric.case_pass).length, metrics.length),
    task_pass_rate: ratio(taskEvaluated.filter((metric) => metric.task_pass).length, taskEvaluated.length),
    effective_call_rate: ratio(effectiveEvaluated.filter((metric) => metric.effective_call).length, effectiveEvaluated.length),
    false_call_rate: ratio(falseCallEvaluated.filter((metric) => metric.false_call).length, falseCallEvaluated.length),
    positive_cases: effectiveEvaluated.length,
    called_positive_cases: effectiveEvaluated.filter((metric) => metric.effective_call).length,
    correct_tool_cases: selectionEvaluated.filter((metric) => metric.selection_correct).length,
    negative_cases: falseCallEvaluated.length,
    false_call_cases: falseCallEvaluated.filter((metric) => metric.false_call).length,
    by_tool_family: { memory: familyMetrics(usable, "memory"), skill: familyMetrics(usable, "skill") },
    tool_micro_precision: ratio(tp, tp + fp),
    tool_micro_recall: ratio(tp, tp + fn),
    tool_selection_accuracy: ratio(selectionEvaluated.filter((metric) => metric.selection_correct).length, selectionEvaluated.length),
    argument_accuracy: ratio(argGood, argTotal),
    duplicate_tool_calls: metrics.reduce((sum, metric) => sum + metric.duplicate_tool_calls, 0),
    provider_input_tokens: distribution(usable.map((run) => run.usage.provider?.input_tokens)),
    provider_output_tokens: distribution(usable.map((run) => run.usage.provider?.output_tokens)),
    provider_total_tokens: distribution(usable.map((run) => run.usage.provider?.total_tokens)),
    definition_tokens: distribution(usable.map((run) => run.usage.definition_tokens)),
    static_definition: summarizeStaticDefinitions(usable),
    llm_calls: distribution(metrics.map((metric) => metric.llm_calls)),
    tool_calls: distribution(metrics.map((metric) => metric.tool_calls)),
    internal_reentry_rounds: distribution(metrics.map((metric) => metric.internal_reentry_rounds)),
    ttft_ms: distribution(usable.map((run) => run.latency.ttft_ms)),
    end_to_end_ms: distribution(caseLatencies(usable)),
    tool_latency_ms: distribution(usable.flatMap((run) => run.latency.tool_ms)),
  };
}

export function summarizeRuns(runs: CaseRun[]) {
  const variants: Record<string, AggregateMetrics> = {};
  const suites: Record<string, { overall: AggregateMetrics; variants: Record<string, AggregateMetrics> }> = {};
  for (const variant of ["baseline", "native"] as const) {
    const selected = runs.filter((run) => run.variant === variant);
    if (selected.length > 0) variants[variant] = aggregateRuns(selected);
  }
  for (const suite of new Set(runs.map((run) => run.case.suite))) {
    const selected = runs.filter((run) => run.case.suite === suite);
    suites[suite] = { overall: aggregateRuns(selected), variants: Object.fromEntries(
      [...new Set(selected.map((run) => run.variant))].map((variant) => [variant, aggregateRuns(selected.filter((run) => run.variant === variant))]),
    ) };
  }
  const failureDistribution: Record<string, number> = {};
  for (const tag of runs.flatMap((run) => run.failure_tags)) failureDistribution[tag] = (failureDistribution[tag] ?? 0) + 1;
  const baselineTokens = variants.baseline?.static_definition.tokens ?? null;
  const nativeTokens = variants.native?.static_definition.tokens ?? null;
  const tokenWarnings = [...new Set(Object.values(variants).flatMap((variant) => variant.static_definition.warnings))];
  const latencyPairs = pairedValues(runs, "end_to_end_ms");
  const baselineLatency = distribution(latencyPairs.map((pair) => pair.baseline)).mean;
  const nativeLatency = distribution(latencyPairs.map((pair) => pair.native)).mean;
  return {
    overall: aggregateRuns(runs), variants, suites, failure_distribution: failureDistribution,
    static_token_comparison: {
      baseline_tokens: baselineTokens, native_tokens: nativeTokens,
      warnings: tokenWarnings,
      reduction_percent: tokenWarnings.length === 0 && baselineTokens !== null && baselineTokens > 0 && nativeTokens !== null ? (baselineTokens - nativeTokens) / baselineTokens * 100 : null,
    },
    end_to_end_comparison: {
      paired_cases: latencyPairs.length, baseline_mean_ms: baselineLatency, native_mean_ms: nativeLatency,
      change_percent: baselineLatency !== null && baselineLatency > 0 && nativeLatency !== null ? (nativeLatency - baselineLatency) / baselineLatency * 100 : null,
    },
  };
}

function pairedValues(runs: CaseRun[], field: string): Array<{ baseline: number; native: number }> {
  const pairs = new Map<string, Record<"baseline" | "native", number[]>>();
  for (const run of runs) {
    if (!usableRun(run)) continue;
    const value = pairedValue(run, field);
    if (value === null || !Number.isFinite(value) || (field === "end_to_end_ms" && value < 0)) continue;
    const key = JSON.stringify([run.experiment_id, run.case_id]);
    const pair = pairs.get(key) ?? { baseline: [], native: [] };
    pair[run.variant].push(value);
    pairs.set(key, pair);
  }
  return [...pairs.values()].flatMap((pair) => {
    const baseline = distribution(pair.baseline).mean;
    const native = distribution(pair.native).mean;
    return baseline === null || native === null ? [] : [{ baseline, native }];
  });
}

function pairedValue(run: CaseRun, field: string): number | null {
  if (field === "case_pass") return run.metrics ? Number(run.metrics.case_pass) : null;
  if (field === "task_pass") return run.metrics?.task_pass === null || run.metrics?.task_pass === undefined ? null : Number(run.metrics.task_pass);
  if (field === "provider_total_tokens") return run.usage.provider?.total_tokens ?? null;
  if (field === "definition_tokens") return run.usage.definition_tokens;
  if (field === "ttft_ms") return run.latency.ttft_ms;
  if (field === "end_to_end_ms") return run.latency.end_to_end_ms;
  if (field === "llm_calls") return run.metrics?.llm_calls ?? null;
  if (field === "tool_calls") return run.metrics?.tool_calls ?? null;
  if (field === "internal_reentry_rounds") return run.metrics?.internal_reentry_rounds ?? null;
  return null;
}

export function pairedDeltas(runs: CaseRun[]): Record<string, ReturnType<typeof distribution>> {
  const fields = ["case_pass", "task_pass", "provider_total_tokens", "definition_tokens", "llm_calls", "tool_calls", "internal_reentry_rounds", "ttft_ms", "end_to_end_ms"];
  return Object.fromEntries(fields.map((field) => [field, distribution(pairedValues(runs, field).map((pair) => pair.native - pair.baseline))]));
}
