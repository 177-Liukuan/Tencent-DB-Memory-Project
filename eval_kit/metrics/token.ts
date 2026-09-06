import { getEncoding } from "js-tiktoken";

import type { CaseRun, ModelCall, StaticDefinitionSummary, Variant } from "../types.js";
import { MANAGED_TOOL_NAMES } from "../recorder/tool-registry.js";

// 只统计真实注入块，避免把正文中提到的 `<skill_tools>` 等标签当作块起点。
const TOOL_BLOCKS = /^[\t ]*<(tdai_memory_tools|memory-tools-guide|skill_tools|knowledge_tools|tdai_profile_memory|knowledge_catalog|native_tool_usage)\b[^>]*>[\s\S]*?<\/\1>/gimu;

// Skill 的调用引导位于目录标签之外；按现有渲染器的标题和末句限定范围，
// 不把后面的 Claude Code 提示词一起计入。渲染器变更时需同步这两个边界。
const SKILL_GUIDANCE = [
  /^## Skills \(mandatory\)\r?\n[\s\S]*?^Only proceed without loading a skill if genuinely none are relevant to the task\.[\t ]*(?=\r?$)/gm,
  /^## Available Cloud Skills(?:，[^\r\n]*)?\r?\n[\s\S]*?^只有在实际读取 Skill 内容后，才能声称已经使用该 Skill。[\t ]*(?=\r?$)/gm,
];

const HEADER_PLACEHOLDERS: Record<string, string> = {
  "x-conversation-id": "<SESSION_ID>",
  "x-tdai-service-id": "<SPACE_ID>",
  "x-tdai-space-id": "<SPACE_ID>",
  "x-tdai-user-id": "<USER_ID>",
  "x-tdai-team-id": "<TEAM_ID>",
  "x-tdai-agent-id": "<AGENT_ID>",
};

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

function toolName(tool: unknown): string | null {
  if (!tool || typeof tool !== "object") return null;
  const record = tool as Record<string, unknown>;
  if (typeof record.name === "string") return record.name;
  const fn = record.function;
  return fn && typeof fn === "object" && typeof (fn as Record<string, unknown>).name === "string"
    ? (fn as Record<string, unknown>).name as string
    : null;
}

function systemText(system: unknown): string {
  if (typeof system === "string") return system;
  if (Array.isArray(system)) {
    return system.flatMap((block) => {
      if (typeof block === "string") return [block];
      if (block && typeof block === "object" && typeof (block as Record<string, unknown>).text === "string") return [(block as Record<string, unknown>).text as string];
      return [];
    }).join("\n");
  }
  return system === null || system === undefined ? "" : JSON.stringify(system);
}

function messageInstructions(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  return messages.flatMap((message) => {
    if (!message || typeof message !== "object") return [];
    const record = message as Record<string, unknown>;
    return record.role === "system" || record.role === "developer" ? [systemText(record.content)] : [];
  }).join("\n");
}

function debugInput(input: unknown): { system: unknown; tools: unknown[] } | null {
  // Langfuse v2 API 的 io 字段可以是 JSON 字符串；读不到输入不能记成零成本。
  if (typeof input === "string") {
    try { input = JSON.parse(input); } catch { return null; }
  }
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    if (!["system", "instructions", "messages", "input", "tools"].some((key) => key in record)) return null;
    return {
      // Responses 可以同时有 instructions 和 input 中的 developer 消息，两者都属于输入。
      system: [systemText(record.system), systemText(record.instructions), messageInstructions(record.messages), messageInstructions(record.input)].filter(Boolean).join("\n"),
      tools: Array.isArray(record.tools) ? record.tools : [],
    };
  }
  if (Array.isArray(input)) {
    return { system: messageInstructions(input), tools: [] };
  }
  return null;
}

function fixedText(block: string): string {
  // 保留目录前后的使用说明，移除随 Agent、资产和任务变化的正文及目录条目。
  // 连续条目连同中间空行一起移除，目录条数也不应改变固定说明的统计值。
  return block
    .replace(/<(available_skills|agent|l3_core_memory|l2_scene_index)\b[^>]*>[\s\S]*?<\/\1>(?:\s*<\1\b[^>]*>[\s\S]*?<\/\1>)*/giu, "")
    .replace(/<knowledge\b[^>]*\/\s*>(?:\s*<knowledge\b[^>]*\/\s*>)*/giu, "")
    .replace(/\b(x-conversation-id|x-tdai-(?:service|space|user|team|agent)-id):[\t ]*[^\s'"`\\、；，。;,]+/giu,
      (_match, header: string) => `${header}: ${HEADER_PLACEHOLDERS[header.toLowerCase()]}`);
}

function fixedSystemBlocks(system: unknown): string[] {
  const text = systemText(system);
  const blocks = [...text.matchAll(TOOL_BLOCKS)].map((match) => fixedText(match[0]));
  for (const pattern of SKILL_GUIDANCE) {
    for (const match of text.matchAll(pattern)) {
      if (/<available_skills\b/u.test(match[0])) blocks.push(fixedText(match[0]));
    }
  }
  return blocks;
}

export function extractBaselineToolDefinitions(system: unknown): string {
  return fixedSystemBlocks(system).join("\n");
}

export function canonicalManagedToolSchema(tools: unknown[]): string {
  const selected = tools
    .filter((tool) => {
      const name = toolName(tool);
      return name !== null && MANAGED_TOOL_NAMES.has(name);
    })
    // cache_control 是传输元数据；Schema 内同名的业务属性仍必须保留。
    .map((tool) => Object.fromEntries(Object.entries(tool as Record<string, unknown>).filter(([key]) => key !== "cache_control")))
    .sort((left, right) => String(toolName(left)).localeCompare(String(toolName(right))));
  return JSON.stringify(canonical(selected));
}

/**
 * 固定工具说明成本：System 各注入块分别编码求和，Native 再加完整 Schema 数组。
 * 只计算输入中实际出现的内容，不补造空资产时未注入的引导；不等同于计费 Token。
 */
export function estimateDefinitionTokens(_variant: Variant, input: unknown): number | null {
  const parts = definitionParts(input);
  if (!parts) return null;
  return countParts(parts).total_tokens;
}

export const TOKENIZER_NAME = "cl100k_base";
let encoder: ReturnType<typeof getEncoding> | undefined;

function countText(text: string): number {
  encoder ??= getEncoding(TOKENIZER_NAME);
  // 提示词中的特殊 Token 字样作为普通文本计数，不能让用户内容中断评测。
  return encoder.encode(text, [], []).length;
}

function definitionParts(input: unknown): { system: string[]; schema: string } | null {
  const parsed = debugInput(input);
  if (!parsed) return null;
  // 以实际输入为准：即使实验标签配错，也不能漏算另一种形式的说明或 Schema。
  const schema = canonicalManagedToolSchema(parsed.tools);
  return { system: fixedSystemBlocks(parsed.system), schema: schema === "[]" ? "" : schema };
}

export function definitionInputForModelCalls(variant: Variant, calls: ModelCall[]): unknown {
  const parsed = calls.map((call) => ({ input: call.input, parsed: debugInput(call.input) }));
  // 初始化请求可能没有 tools；优先选工具已注入的第一条完整请求。
  if (variant === "native") {
    const native = parsed.find((item) => item.parsed && canonicalManagedToolSchema(item.parsed.tools) !== "[]");
    if (native) return native.input;
  }
  return parsed.find((item) => item.parsed && item.parsed.tools.length > 0)?.input ?? parsed.find((item) => item.parsed)?.input;
}

function countParts(parts: { system: string[]; schema: string }): { system_tokens: number; schema_tokens: number; total_tokens: number } {
  const systemTokens = parts.system.reduce((total, block) => total + countText(block), 0);
  const schemaTokens = parts.schema ? countText(parts.schema) : 0;
  return { system_tokens: systemTokens, schema_tokens: schemaTokens, total_tokens: systemTokens + schemaTokens };
}

export function summarizeStaticDefinitions(runs: CaseRun[]): StaticDefinitionSummary {
  const configurations = new Map<string, StaticDefinitionSummary["configurations"][number]>();
  let checked = 0;
  const warnings = new Set<string>();
  for (const run of runs) {
    if (run.status !== "completed" || !run.trace.complete) continue;
    const parts = definitionParts(definitionInputForModelCalls(run.variant, run.model_calls));
    if (!parts) continue;
    if (run.variant === "native" && parts.system.some((block) => /^\s*<(tdai_memory_tools|memory-tools-guide|skill_tools|knowledge_tools)\b/u.test(block) || block.startsWith("## Skills (mandatory)"))) warnings.add("native_contains_fake_tool_guidance");
    if (run.variant === "native" && !parts.schema) warnings.add("native_has_no_managed_schema");
    if (run.variant === "baseline" && parts.schema) warnings.add("baseline_contains_managed_schema");
    checked += 1;
    // 只比较固定内容，不受 Query、目录条数和运行次数影响；同配置只编码一次。
    const key = JSON.stringify([run.variant, parts]);
    if (!configurations.has(key)) configurations.set(key, { source_run_id: run.run_id, variant: run.variant, ...countParts(parts) });
  }
  const values = [...configurations.values()];
  return { tokenizer: TOKENIZER_NAME, samples_checked: checked, tokens: values.length === 1 ? values[0]!.total_tokens : null, configurations: values, warnings: [...warnings] };
}
