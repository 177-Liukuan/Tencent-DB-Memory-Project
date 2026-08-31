export type Variant = "baseline" | "native";
export type Suite = "smoke" | "main" | "reliability";
export type ToolFamily = "memory" | "skill" | "knowledge" | "none";
export type Difficulty = "easy" | "medium" | "hard";

export type AnswerAssertion = {
  operator: "exact" | "contains" | "regex";
  value: string;
  flags?: string;
};

export type ArgumentAssertion = {
  tool?: string;
  path: string;
  operator: "exists" | "equals" | "contains" | "regex" | "range";
  value?: unknown;
  flags?: string;
  min?: number;
  max?: number;
};

export type EvalCase = {
  schema_version: 1;
  case_id: string;
  suite: Suite;
  query: string;
  should_call: boolean;
  expected_tool?: string | null;
  expected_tools: string[];
  argument_assertions?: ArgumentAssertion[];
  answer_assertions?: AnswerAssertion[];
  tool_family?: ToolFamily;
  difficulty?: Difficulty;
  tags?: string[];
};

export type RawRequest = {
  at: string | null;
  method: string | null;
  path: string | null;
  headers: Record<string, string | string[]>;
  body: unknown;
} | null;

export type ModelCall = {
  observation_id: string | null;
  trace_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  model: string | null;
  input: unknown;
  output: unknown;
  thinking: unknown;
  stop_reason: string | null;
  usage: ProviderUsage | null;
  latency_ms: number | null;
};

export type ToolCallRecord = {
  call_id: string;
  raw_name: string;
  logical_name: string;
  kind: "managed" | "client" | "unknown";
  arguments: unknown;
  result: unknown;
  error: string | null;
  started_at: string | null;
  ended_at: string | null;
  latency_ms: number | null;
  endpoint?: string | null;
  normalization_error?: string | null;
};

export type ProviderUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
};

export type CaseMetrics = {
  expected_tools: string[];
  actual_tools: string[];
  tool_true_positives: number;
  tool_false_positives: number;
  tool_false_negatives: number;
  managed_tool_calls: number;
  duplicate_tool_calls: number;
  effective_call: boolean | null;
  false_call: boolean | null;
  selection_correct: boolean | null;
  argument_pass: boolean | null;
  argument_correct_calls: number;
  argument_evaluated_calls: number;
  task_pass: boolean | null;
  case_pass: boolean;
  llm_calls: number;
  tool_calls: number;
  internal_reentry_rounds: number;
};

export type FailureTag =
  | "Missing Tool"
  | "False Positive"
  | "Wrong Tool"
  | "Extra Tool"
  | "Invalid Arguments"
  | "Tool Error"
  | "Task Mismatch"
  | "Timeout"
  | "Infra Error"
  | "Trace Incomplete";

export type CaseRun = {
  schema_version: 1;
  run_id: string;
  experiment_id: string;
  case_id: string;
  variant: Variant;
  session_id: string;
  identity: {
    service_id: string;
    team_id: string;
    agent_id: string;
    task_id: string;
  };
  case: {
    suite: Suite;
    query: string;
    should_call: boolean;
    expected_tools: string[];
    argument_assertions: ArgumentAssertion[];
    answer_assertions: AnswerAssertion[];
  };
  status: "completed" | "timeout" | "infra_error";
  started_at: string;
  ended_at: string;
  raw_request: RawRequest;
  model_calls: ModelCall[];
  tool_calls: ToolCallRecord[];
  final_answer: string | null;
  usage: {
    provider: ProviderUsage | null;
    definition_tokens: number | null;
  };
  latency: {
    end_to_end_ms: number | null;
    ttft_ms: number | null;
    tool_ms: number[];
  };
  trace: {
    complete: boolean;
    langfuse_url: string | null;
    artifacts: Record<string, string>;
    client_request_count?: number;
  };
  metrics: CaseMetrics | null;
  failure_tags: FailureTag[];
  error?: string | null;
  tool_family?: ToolFamily;
  difficulty?: Difficulty;
  tags?: string[];
};

export type Distribution = {
  count: number;
  mean: number | null;
  median: number | null;
  p95: number | null;
};

export type AggregateMetrics = {
  runs: number;
  completed_runs: number;
  trace_complete_runs: number;
  case_pass_rate: number | null;
  task_pass_rate: number | null;
  effective_call_rate: number | null;
  false_call_rate: number | null;
  tool_micro_precision: number | null;
  tool_micro_recall: number | null;
  tool_selection_accuracy: number | null;
  argument_accuracy: number | null;
  duplicate_tool_calls: number;
  provider_input_tokens: Distribution;
  provider_output_tokens: Distribution;
  provider_total_tokens: Distribution;
  definition_tokens: Distribution;
  llm_calls: Distribution;
  tool_calls: Distribution;
  internal_reentry_rounds: Distribution;
  ttft_ms: Distribution;
  end_to_end_ms: Distribution;
  tool_latency_ms: Distribution;
};
