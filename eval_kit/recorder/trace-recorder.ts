import type { ModelCall, ProviderUsage, RawRequest, ToolCallRecord, Variant } from "../types.js";
import { isProxyModelGeneration } from "./observations.js";
import { normalizeClaudeStream } from "./tool-registry.js";

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try { return JSON.parse(value); } catch { return value; }
}

function dateMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function numberFrom(record: Record<string, unknown>, names: string[]): number | null {
  for (const name of names) {
    const value = record[name];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return null;
}

function normalizeUsage(value: unknown): ProviderUsage | null {
  if (!value || typeof value !== "object") return null;
  const usage = value as Record<string, unknown>;
  const input = numberFrom(usage, ["input", "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"]);
  const output = numberFrom(usage, ["output", "output_tokens", "outputTokens", "completion_tokens", "completionTokens"]);
  const total = numberFrom(usage, ["total", "total_tokens", "totalTokens"])
    ?? (input !== null || output !== null ? (input ?? 0) + (output ?? 0) : null);
  if (input === null && output === null && total === null) return null;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: total,
    cache_read_input_tokens: numberFrom(usage, ["input_cached_tokens", "cache_read_input_tokens", "cacheReadInputTokens", "cachedInputTokens"]),
    cache_creation_input_tokens: numberFrom(usage, ["cache_creation_input_tokens", "cacheCreationInputTokens", "cache_write_input_tokens", "cacheWriteInputTokens"]),
  };
}

function normalizeObservationUsage(observation: Record<string, unknown>): ProviderUsage | null {
  const details = normalizeUsage(observation.usage ?? observation.usageDetails ?? observation.usage_details);
  const topInput = numberFrom(observation, ["inputUsage", "input_usage"]);
  const topOutput = numberFrom(observation, ["outputUsage", "output_usage"]);
  const topTotal = numberFrom(observation, ["totalUsage", "total_usage"]);
  if (topInput === null && topOutput === null && topTotal === null) return details;
  const input = topInput ?? details?.input_tokens ?? null;
  const output = topOutput ?? details?.output_tokens ?? null;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: topTotal ?? (input !== null || output !== null ? (input ?? 0) + (output ?? 0) : details?.total_tokens ?? null),
    cache_read_input_tokens: details?.cache_read_input_tokens ?? null,
    cache_creation_input_tokens: details?.cache_creation_input_tokens ?? null,
  };
}

function combineUsage(values: ProviderUsage[]): ProviderUsage | null {
  if (values.length === 0) return null;
  const sum = (field: keyof ProviderUsage): number | null => {
    const available = values.map((value) => value[field]).filter((value): value is number => typeof value === "number");
    return available.length === 0 ? null : available.reduce((total, value) => total + value, 0);
  };
  return {
    input_tokens: sum("input_tokens"),
    output_tokens: sum("output_tokens"),
    total_tokens: sum("total_tokens"),
    cache_read_input_tokens: sum("cache_read_input_tokens"),
    cache_creation_input_tokens: sum("cache_creation_input_tokens"),
  };
}

function messagesFromInput(input: unknown): unknown[] {
  const parsed = parseJson(input);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    const messages = (parsed as Record<string, unknown>).messages;
    return Array.isArray(messages) ? messages : [];
  }
  return [];
}

function assistantMessage(output: unknown): unknown | null {
  const parsed = parseJson(output);
  if (!parsed) return null;
  if (Array.isArray(parsed)) return { role: "assistant", content: parsed };
  if (typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    if (record.role === "assistant") return record;
    if (Array.isArray(record.content)) return { role: "assistant", content: record.content };
  }
  return null;
}

function thinkingFrom(output: unknown): unknown {
  const assistant = assistantMessage(output);
  if (!assistant || typeof assistant !== "object") return null;
  const content = (assistant as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  const blocks = content.filter((block) => block && typeof block === "object" && ["thinking", "redacted_thinking"].includes(String((block as Record<string, unknown>).type)));
  return blocks.length > 0 ? blocks : null;
}

function clientAssistantMessages(events: Record<string, unknown>[]): Array<{ role: "assistant"; content: unknown[]; stop_reason: string | null }> {
  const groups: Array<{ role: "assistant"; content: unknown[]; stop_reason: string | null }> = [];
  let active: { role: "assistant"; content: unknown[]; stop_reason: string | null } | null = null;
  let resultStopReason: string | null = null;
  for (const event of events) {
    if (event.type === "assistant" && event.message && typeof event.message === "object") {
      const content = (event.message as Record<string, unknown>).content;
      if (!Array.isArray(content)) continue;
      if (!active) {
        active = { role: "assistant", content: [], stop_reason: null };
        groups.push(active);
      }
      active.content.push(...content);
      const messageStopReason = (event.message as Record<string, unknown>).stop_reason;
      if (typeof messageStopReason === "string") active.stop_reason = messageStopReason;
      continue;
    }
    if (event.type === "result" && typeof event.stop_reason === "string") resultStopReason = event.stop_reason;
    if (event.type === "user" || event.type === "result") active = null;
  }
  const populated = groups.filter((group) => group.content.length > 0);
  for (const group of populated) {
    if (group.content.some((block) => block && typeof block === "object" && (block as Record<string, unknown>).type === "tool_use")) {
      group.stop_reason ??= "tool_use";
    }
  }
  if (resultStopReason && populated.length > 0) (populated.at(-1) as typeof populated[number]).stop_reason = resultStopReason;
  return populated;
}

function modelCall(observation: Record<string, unknown>): ModelCall {
  const started = observation.startTime ?? observation.start_time ?? observation.createdAt ?? observation.created_at;
  const ended = observation.endTime ?? observation.end_time ?? observation.updatedAt ?? observation.updated_at;
  const startMs = dateMs(started);
  const endMs = dateMs(ended);
  const output = parseJson(observation.output);
  const stopReason = output && typeof output === "object"
    ? ((output as Record<string, unknown>).stop_reason ?? (output as Record<string, unknown>).stopReason)
    : null;
  return {
    observation_id: typeof observation.id === "string" ? observation.id : null,
    trace_id: typeof observation.traceId === "string" ? observation.traceId : typeof observation.trace_id === "string" ? observation.trace_id : null,
    started_at: typeof started === "string" ? started : null,
    ended_at: typeof ended === "string" ? ended : null,
    model: typeof observation.model === "string" ? observation.model : null,
    input: parseJson(observation.input),
    output,
    thinking: thinkingFrom(output),
    stop_reason: typeof stopReason === "string" ? stopReason : null,
    usage: normalizeObservationUsage(observation),
    latency_ms: startMs !== null && endMs !== null ? Math.max(0, endMs - startMs) : null,
  };
}

function mergeCalls(primary: ToolCallRecord[], secondary: ToolCallRecord[]): ToolCallRecord[] {
  const calls = new Map<string, ToolCallRecord>();
  for (const call of [...secondary, ...primary]) {
    const existing = calls.get(call.call_id);
    calls.set(call.call_id, existing ? {
      ...existing,
      ...call,
      result: call.result ?? existing.result,
      error: call.error ?? existing.error,
      endpoint: call.endpoint ?? existing.endpoint ?? null,
      latency_ms: call.latency_ms ?? existing.latency_ms,
    } : { ...call });
  }
  return [...calls.values()];
}

function callsFromObservations(observations: Record<string, unknown>[]): ToolCallRecord[] {
  const messages: unknown[] = [];
  const sorted = [...observations].sort((left, right) => String(left.startTime ?? left.start_time).localeCompare(String(right.startTime ?? right.start_time)));
  for (const observation of sorted) {
    messages.push(...messagesFromInput(observation.input));
    const assistant = assistantMessage(observation.output);
    if (assistant) messages.push(assistant);
  }
  // 两个采集来源使用同一套名称映射，Baseline 的 Bash/curl 也能从上游记录补回。
  return normalizeClaudeStream(messages.map((message) => ({ message }))).tool_calls;
}

function clickhouseCallId(row: Record<string, unknown>): string | null {
  for (const key of ["call_id", "tool_call_id", "id"]) if (typeof row[key] === "string") return row[key] as string;
  return null;
}

export type NormalizeTraceInput = {
  variant: Variant;
  tapEvents: Record<string, unknown>[];
  clientEvents: Record<string, unknown>[];
  observations: Record<string, unknown>[];
  clickhouseRows: Record<string, unknown>[];
  traceComplete: boolean;
  langfuseBaseUrl: string;
  langfuseProjectId: string | null;
};

export type NormalizedTrace = {
  raw_request: RawRequest;
  model_calls: ModelCall[];
  tool_calls: ToolCallRecord[];
  final_answer: string | null;
  usage: ProviderUsage | null;
  langfuse_url: string | null;
};

export function normalizeTrace(input: NormalizeTraceInput): NormalizedTrace {
  const modelObservations = input.observations
    .filter(isProxyModelGeneration)
    .sort((left, right) => String(left.startTime ?? left.start_time ?? "").localeCompare(String(right.startTime ?? right.start_time ?? "")));
  const request = input.tapEvents.find((event) => event.kind === "request");
  const rawRequest: RawRequest = request ? {
    at: typeof request.at === "string" ? request.at : null,
    method: typeof request.method === "string" ? request.method : null,
    path: typeof request.path === "string" ? request.path : null,
    headers: request.headers && typeof request.headers === "object" ? request.headers as Record<string, string | string[]> : {},
    body: request.body ?? null,
  } : null;
  const client = normalizeClaudeStream(input.clientEvents);
  let toolCalls = mergeCalls(client.tool_calls, callsFromObservations(modelObservations));
  const rowsById = new Map(input.clickhouseRows.flatMap((row) => {
    const id = clickhouseCallId(row);
    return id ? [[id, row] as const] : [];
  }));
  toolCalls = toolCalls.map((call) => {
    // 同名工具可以被多次调用，数据库返回顺序也可能不同；只用调用 ID 关联。
    const row = rowsById.get(call.call_id);
    if (!row) return call;
    const status = row.upstream_status;
    return {
      ...call,
      endpoint: typeof row.executed_endpoint === "string" ? row.executed_endpoint : call.endpoint ?? null,
      latency_ms: typeof row.elapsed_ms === "number" ? row.elapsed_ms : call.latency_ms,
      error: typeof status === "number" && status >= 400 ? `Upstream HTTP ${status}` : call.error,
    };
  });
  const calls = modelObservations.map(modelCall);
  const clientMessages = clientAssistantMessages(input.clientEvents);
  const matchedMessages = clientMessages.slice(-calls.length);
  const callOffset = calls.length - matchedMessages.length;
  matchedMessages.forEach((message, index) => {
    const call = calls[callOffset + index];
    if (!call) return;
    call.output = message;
    call.thinking = thinkingFrom(message);
    call.stop_reason = message.stop_reason ?? call.stop_reason;
  });
  const providerUsage = input.traceComplete
    ? combineUsage(modelObservations.flatMap((observation) => {
        const usage = normalizeObservationUsage(observation);
        return usage ? [usage] : [];
      }))
    : null;
  const traceId = calls.find((call) => call.trace_id)?.trace_id ?? null;
  const langfuseUrl = traceId && input.langfuseProjectId
    ? `${input.langfuseBaseUrl.replace(/\/$/u, "")}/project/${encodeURIComponent(input.langfuseProjectId)}/traces/${encodeURIComponent(traceId)}`
    : traceId ? `${input.langfuseBaseUrl.replace(/\/$/u, "")}/trace/${encodeURIComponent(traceId)}` : null;
  return {
    raw_request: rawRequest,
    model_calls: calls,
    tool_calls: toolCalls,
    final_answer: client.final_answer,
    usage: providerUsage,
    langfuse_url: langfuseUrl,
  };
}
