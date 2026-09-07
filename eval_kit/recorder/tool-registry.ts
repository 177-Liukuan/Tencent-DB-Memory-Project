import type { ToolCallRecord } from "../types.js";

const ENDPOINTS: ReadonlyArray<[RegExp, string]> = [
  [/\/tools\/list(?=$|[/?#'"\s])/u, "tdai_knowledge_tools_list"],
  [/\/tools\/call(?=$|[/?#'"\s])/u, "tdai_knowledge_tool_call"],
  [/\/memory-bridge\/v3\/atomic\/search(?=$|[/?#'"\s])/u, "tdai_memory_search"],
  [/\/memory-bridge\/v3\/atomic\/query(?=$|[/?#'"\s])/u, "tdai_atomic_query"],
  [/\/memory-bridge\/v3\/conversation\/search(?=$|[/?#'"\s])/u, "tdai_conversation_search"],
  [/\/memory-bridge\/v3\/conversation\/query(?=$|[/?#'"\s])/u, "tdai_conversation_query"],
  [/\/memory-bridge\/v3\/scenario\/ls(?=$|[/?#'"\s])/u, "tdai_scenario_ls"],
  [/\/memory-bridge\/v3\/scenario\/read(?=$|[/?#'"\s])/u, "tdai_read_scene"],
  [/\/skill-bridge\/v3\/skill\/search(?=$|[/?#'"\s])/u, "skill_search"],
  [/\/skill-bridge\/v3\/skill\/get-by-name(?=$|[/?#'"\s])/u, "skill_view"],
  [/\/skill-bridge\/v3\/skill\/files\/read(?=$|[/?#'"\s])/u, "skill_files_read"],
  [/\/skill-bridge\/v3\/skill\/extract(?=$|[/?#'"\s])/u, "skill_extract"],
  [/\/skill-bridge\/v3\/skill\/create(?=$|[/?#'"\s])/u, "skill_create"],
  [/\/skill-bridge\/v3\/skill\/update(?=$|[/?#'"\s])/u, "skill_update"],
  [/\/skill-bridge\/v3\/skill\/patch(?=$|[/?#'"\s])/u, "skill_patch"],
  [/\/skill-bridge\/v3\/skill\/delete(?=$|[/?#'"\s])/u, "skill_delete"],
  [/\/skill-bridge\/v3\/skill\/files\/write(?=$|[/?#'"\s])/u, "skill_files_write"],
  [/\/skill-bridge\/v3\/skill\/files\/remove(?=$|[/?#'"\s])/u, "skill_files_remove"],
];

export const MANAGED_TOOL_NAMES = new Set([
  ...ENDPOINTS.map(([, name]) => name),
  "tdai_knowledge_tools_list",
  "tdai_knowledge_tool_call",
]);

function emptyRecord(callId: string, rawName: string, logicalName: string, kind: ToolCallRecord["kind"]): ToolCallRecord {
  return {
    call_id: callId,
    raw_name: rawName,
    logical_name: logicalName,
    kind,
    arguments: {},
    result: null,
    error: null,
    started_at: null,
    ended_at: null,
    latency_ms: null,
  };
}

function parseDataArgument(command: string): { value: unknown; error: string | null } {
  const match = command.match(/(?:--data(?:-raw)?|-d)\s+(?:'([^']*)'|"((?:\\.|[^"\\])*)"|(\S+))/u);
  if (!match) return { value: {}, error: null };
  const raw = match[1] ?? match[2] ?? match[3] ?? "";
  try {
    return { value: JSON.parse(raw.replace(/\\"/gu, '"')), error: null };
  } catch (error) {
    return { value: raw, error: `Could not parse curl data as JSON: ${String(error)}` };
  }
}

export function extractBaselineCurlCall(command: string, callId: string): ToolCallRecord | null {
  // 必须是 curl 的 URL；echo/日志里提到 Bridge 地址不代表模型调用了工具。
  const curl = command.replace(/\\\r?\n/gu, " ").match(/(?:^|&&|\|\||;|\n)\s*(?:command\s+)?(?:\/[^\s]+\/)?curl\s+([\s\S]*)/u)?.[1];
  if (!curl) return null;
  const url = curl.match(/https?:\/\/[^\s'"\\]+/u)?.[0];
  if (!url) return null;
  const match = ENDPOINTS.find(([pattern]) => pattern.test(url));
  if (!match) return null;
  const [, logicalName] = match;
  const args = parseDataArgument(curl);
  return {
    ...emptyRecord(callId, "Bash", logicalName, "managed"),
    arguments: args.value,
    endpoint: url,
    normalization_error: args.error,
  };
}

function blocksFromMessage(message: unknown): unknown[] {
  if (!message || typeof message !== "object") return [];
  const content = (message as Record<string, unknown>).content;
  return Array.isArray(content) ? content : [];
}

function businessEnvelopeError(content: unknown): string | null {
  let value = content;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch { return null; }
  }
  if (Array.isArray(value)) {
    for (const block of value) {
      if (!block || typeof block !== "object") continue;
      const record = block as Record<string, unknown>;
      const error = businessEnvelopeError(record.text ?? record.content);
      if (error) return error;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const envelope = value as Record<string, unknown>;
  const code = envelope.code;
  if ((typeof code !== "number" && typeof code !== "string") || Number(code) === 0) return null;
  const message = typeof envelope.message === "string" && envelope.message ? `: ${envelope.message}` : "";
  return `Tool returned business error ${String(code)}${message}`;
}

export function pairNativeToolBlocks(messages: unknown[]): ToolCallRecord[] {
  const calls = new Map<string, ToolCallRecord>();
  for (const message of messages) {
    for (const raw of blocksFromMessage(message)) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as Record<string, unknown>;
      if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
        // 下一轮请求会重复携带历史，不能用重复的 Tool Call 清空之前保存的结果。
        if (calls.has(block.id)) continue;
        const kind = MANAGED_TOOL_NAMES.has(block.name) ? "managed" : "client";
        calls.set(block.id, {
          ...emptyRecord(block.id, block.name, block.name, kind),
          arguments: block.input ?? {},
        });
      }
      if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const current = calls.get(block.tool_use_id);
        if (current) {
          current.result = block.content ?? null;
          if (block.is_error === true) current.error = typeof block.content === "string" ? block.content : "Tool result reported an error";
          else current.error = businessEnvelopeError(block.content);
        }
      }
    }
  }
  return [...calls.values()];
}

export function normalizeClaudeStream(events: unknown[]): { tool_calls: ToolCallRecord[]; final_answer: string | null; usage: Record<string, unknown> | null } {
  const messages: unknown[] = [];
  const timing = new Map<string, { started_at: string | null; ended_at: string | null }>();
  let finalAnswer: string | null = null;
  let usage: Record<string, unknown> | null = null;
  for (const raw of events) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as Record<string, unknown>;
    if (event.message && typeof event.message === "object") {
      messages.push(event.message);
      const timestamp = typeof event.timestamp === "string" ? event.timestamp : null;
      for (const rawBlock of blocksFromMessage(event.message)) {
        if (!rawBlock || typeof rawBlock !== "object") continue;
        const block = rawBlock as Record<string, unknown>;
        if (block.type === "tool_use" && typeof block.id === "string") {
          const current = timing.get(block.id) ?? { started_at: null, ended_at: null };
          current.started_at ??= timestamp;
          timing.set(block.id, current);
        }
        if (block.type === "tool_result" && typeof block.tool_use_id === "string") {
          const current = timing.get(block.tool_use_id) ?? { started_at: null, ended_at: null };
          current.ended_at = timestamp;
          timing.set(block.tool_use_id, current);
        }
      }
    }
    if (event.type === "result") {
      if (typeof event.result === "string") finalAnswer = event.result;
      if (event.usage && typeof event.usage === "object") usage = event.usage as Record<string, unknown>;
    }
  }
  const native = pairNativeToolBlocks(messages);
  const records = native.map((call) => {
    let normalized = call;
    if (call.raw_name === "Bash") {
    const input = call.arguments && typeof call.arguments === "object" ? call.arguments as Record<string, unknown> : {};
    const command = typeof input.command === "string" ? input.command : "";
    const baseline = extractBaselineCurlCall(command, call.call_id);
      if (baseline) {
        baseline.result = call.result;
        baseline.error = call.error;
        normalized = baseline;
      }
    }
    const times = timing.get(call.call_id);
    if (!times) return normalized;
    const startedMs = times.started_at ? Date.parse(times.started_at) : Number.NaN;
    const endedMs = times.ended_at ? Date.parse(times.ended_at) : Number.NaN;
    return {
      ...normalized,
      ...times,
      latency_ms: Number.isFinite(startedMs) && Number.isFinite(endedMs) ? Math.max(0, endedMs - startedMs) : null,
    };
  });
  return { tool_calls: records, final_answer: finalAnswer, usage };
}
