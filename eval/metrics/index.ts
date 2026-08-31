import type { AggregateMetrics, CaseRun, EvalCase, FailureTag } from "../types.js";
import { distribution } from "./latency.js";
import { scoreTask } from "./task.js";
import { assertionsForCall, evaluateArgument } from "./tool.js";

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

export function scoreRun(testCase: EvalCase, source: CaseRun): CaseRun {
  const managed = source.tool_calls.filter((call) => call.kind === "managed");
  const expected = [...new Set(testCase.expected_tools)];
  const actual = [...new Set(managed.map((call) => call.logical_name))];
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const intersection = actual.filter((name) => expectedSet.has(name));
  const falsePositives = actual.filter((name) => !expectedSet.has(name));
  const falseNegatives = expected.filter((name) => !actualSet.has(name));
  const tags = new Set<FailureTag>();

  if (source.status === "timeout") tags.add("Timeout");
  if (source.status === "infra_error") tags.add("Infra Error");
  if (!source.trace.complete) tags.add("Trace Incomplete");
  if (testCase.should_call && managed.length === 0) tags.add("Missing Tool");
  if (!testCase.should_call && managed.length > 0) tags.add("False Positive");
  if (testCase.should_call && managed.length > 0 && falseNegatives.length > 0) tags.add("Wrong Tool");
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
    ? expected.length === actual.length && expected.every((name) => actualSet.has(name)) && argumentPass !== false && !managed.some((call) => call.error)
    : managed.length === 0;
  const runComplete = source.status === "completed" && source.trace.complete;
  const casePass = runComplete && toolBehaviorPass && taskPass !== false;

  return {
    ...source,
    ...(testCase.tool_family ? { tool_family: testCase.tool_family } : {}),
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
      selection_correct: testCase.should_call && managed.length > 0
        ? expected.length === actual.length && expected.every((name) => actualSet.has(name))
        : null,
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

export function aggregateRuns(runs: CaseRun[]): AggregateMetrics {
  const metrics = runs
    .filter((run) => run.status === "completed" && run.trace.complete)
    .flatMap((run) => run.metrics ? [run.metrics] : []);
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
    tool_micro_precision: ratio(tp, tp + fp),
    tool_micro_recall: ratio(tp, tp + fn),
    tool_selection_accuracy: ratio(selectionEvaluated.filter((metric) => metric.selection_correct).length, selectionEvaluated.length),
    argument_accuracy: ratio(argGood, argTotal),
    duplicate_tool_calls: metrics.reduce((sum, metric) => sum + metric.duplicate_tool_calls, 0),
    provider_input_tokens: distribution(runs.map((run) => run.usage.provider?.input_tokens)),
    provider_output_tokens: distribution(runs.map((run) => run.usage.provider?.output_tokens)),
    provider_total_tokens: distribution(runs.map((run) => run.usage.provider?.total_tokens)),
    definition_tokens: distribution(runs.map((run) => run.usage.definition_tokens)),
    llm_calls: distribution(metrics.map((metric) => metric.llm_calls)),
    tool_calls: distribution(metrics.map((metric) => metric.tool_calls)),
    internal_reentry_rounds: distribution(metrics.map((metric) => metric.internal_reentry_rounds)),
    ttft_ms: distribution(runs.map((run) => run.latency.ttft_ms)),
    end_to_end_ms: distribution(runs.map((run) => run.latency.end_to_end_ms)),
    tool_latency_ms: distribution(runs.flatMap((run) => run.latency.tool_ms)),
  };
}

export function summarizeRuns(runs: CaseRun[]): { overall: AggregateMetrics; variants: Record<string, AggregateMetrics>; failure_distribution: Record<string, number> } {
  const variants: Record<string, AggregateMetrics> = {};
  for (const variant of ["baseline", "native"] as const) {
    const selected = runs.filter((run) => run.variant === variant);
    if (selected.length > 0) variants[variant] = aggregateRuns(selected);
  }
  const failureDistribution: Record<string, number> = {};
  for (const tag of runs.flatMap((run) => run.failure_tags)) failureDistribution[tag] = (failureDistribution[tag] ?? 0) + 1;
  return { overall: aggregateRuns(runs), variants, failure_distribution: failureDistribution };
}

export function pairedDeltas(runs: CaseRun[]): Record<string, ReturnType<typeof distribution>> {
  const pairs = new Map<string, Partial<Record<"baseline" | "native", CaseRun>>>();
  for (const run of runs) {
    const pair = pairs.get(run.case_id) ?? {};
    pair[run.variant] = run;
    pairs.set(run.case_id, pair);
  }
  const fields: Record<string, number[]> = {
    case_pass: [],
    task_pass: [],
    provider_total_tokens: [],
    definition_tokens: [],
    llm_calls: [],
    tool_calls: [],
    internal_reentry_rounds: [],
    ttft_ms: [],
    end_to_end_ms: [],
  };
  const value = (run: CaseRun, field: string): number | null => {
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
  };
  for (const pair of pairs.values()) {
    if (!pair.baseline || !pair.native) continue;
    if (pair.baseline.status !== "completed" || pair.native.status !== "completed" || !pair.baseline.trace.complete || !pair.native.trace.complete) continue;
    for (const field of Object.keys(fields)) {
      const baseline = value(pair.baseline, field);
      const native = value(pair.native, field);
      if (baseline !== null && native !== null) fields[field]?.push(native - baseline);
    }
  }
  return Object.fromEntries(Object.entries(fields).map(([field, values]) => [field, distribution(values)]));
}
