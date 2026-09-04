import { getEncoding } from "js-tiktoken";

import type { Variant } from "../types.js";
import { MANAGED_TOOL_NAMES } from "../recorder/tool-registry.js";

const TOOL_BLOCK = /<(tdai_memory_tools|memory-tools-guide|skill_tools|knowledge_tools)\b[^>]*>[\s\S]*?<\/\1>/giu;

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

function debugInput(input: unknown): { system: unknown; tools: unknown[] } {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const record = input as Record<string, unknown>;
    return { system: record.system, tools: Array.isArray(record.tools) ? record.tools : [] };
  }
  if (Array.isArray(input)) {
    const system = input.find((message) => message && typeof message === "object" && (message as Record<string, unknown>).role === "system");
    return { system: system && typeof system === "object" ? (system as Record<string, unknown>).content : "", tools: [] };
  }
  return { system: "", tools: [] };
}

export function extractBaselineToolDefinitions(system: unknown): string {
  return [...systemText(system).matchAll(TOOL_BLOCK)].map((match) => match[0]).join("\n");
}

export function canonicalManagedToolSchema(tools: unknown[]): string {
  const selected = tools
    .filter((tool) => {
      const name = toolName(tool);
      return name !== null && MANAGED_TOOL_NAMES.has(name);
    })
    .sort((left, right) => String(toolName(left)).localeCompare(String(toolName(right))));
  return JSON.stringify(canonical(selected));
}

export function estimateDefinitionTokens(variant: Variant, input: unknown): number | null {
  const parsed = debugInput(input);
  const text = variant === "baseline"
    ? extractBaselineToolDefinitions(parsed.system)
    : canonicalManagedToolSchema(parsed.tools);
  if (!text || text === "[]") return 0;
  return getEncoding("cl100k_base").encode(text).length;
}

export const TOKENIZER_NAME = "cl100k_base";
