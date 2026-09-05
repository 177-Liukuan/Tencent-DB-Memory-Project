import { isDeepStrictEqual } from "node:util";

import type { ArgumentAssertion, EvalCase, ToolCallRecord, ToolFamily } from "../types.js";
import { MANAGED_TOOL_NAMES } from "../recorder/tool-registry.js";

export function toolFamily(name: string): Exclude<ToolFamily, "none"> | null {
  if (!MANAGED_TOOL_NAMES.has(name)) return null;
  if (name.startsWith("skill_")) return "skill";
  return name.startsWith("tdai_knowledge_") ? "knowledge" : "memory";
}

export function selectionCorrect(testCase: EvalCase, actualSequence: string[]): boolean {
  const sequences = testCase.allowed_sequences
    ?? (testCase.expected_tool_sequence?.length ? [testCase.expected_tool_sequence] : null);
  if (sequences) {
    // 顺序来自调用生成记录，不按工具名称去重，也不按结果返回时间排序。
    return sequences.some((sequence) => sequence.length === actualSequence.length
      && sequence.every((name, index) => name === actualSequence[index]));
  }
  if (testCase.allowed_first_tools) return testCase.allowed_first_tools.includes(actualSequence[0] ?? "");
  if (testCase.expected_tools.length === 1) return actualSequence[0] === testCase.expected_tools[0];
  // 兼容旧数据的“必须调用全部工具”集合标注；有顺序要求的新样本必须显式标注。
  const actual = new Set(actualSequence);
  return actual.size === testCase.expected_tools.length && testCase.expected_tools.every((name) => actual.has(name));
}

function valueAtPath(value: unknown, path: string): { exists: boolean; value: unknown } {
  const parts = path.replace(/^\$\.?/u, "").split(".").filter(Boolean);
  let current = value;
  for (const part of parts) {
    if (!current || typeof current !== "object" || !(part in current)) return { exists: false, value: undefined };
    current = (current as Record<string, unknown>)[part];
  }
  return { exists: true, value: current };
}

function deepEqual(a: unknown, b: unknown): boolean {
  return isDeepStrictEqual(a, b);
}

export function evaluateArgument(assertion: ArgumentAssertion, args: unknown): boolean {
  const actual = valueAtPath(args, assertion.path);
  if (assertion.operator === "exists") return actual.exists === (assertion.value === undefined ? true : Boolean(assertion.value));
  if (!actual.exists) return false;
  if (assertion.operator === "equals") return deepEqual(actual.value, assertion.value);
  if (assertion.operator === "contains") {
    if (typeof actual.value === "string") return actual.value.includes(String(assertion.value ?? ""));
    if (Array.isArray(actual.value)) return actual.value.some((item) => deepEqual(item, assertion.value));
    return false;
  }
  if (assertion.operator === "regex") {
    try { return new RegExp(String(assertion.value ?? ""), assertion.flags).test(String(actual.value)); } catch { return false; }
  }
  if (typeof actual.value !== "number") return false;
  return (assertion.min === undefined || actual.value >= assertion.min)
    && (assertion.max === undefined || actual.value <= assertion.max);
}

export function assertionsForCall(assertions: ArgumentAssertion[] | undefined, call: ToolCallRecord): ArgumentAssertion[] {
  return (assertions ?? []).filter((assertion) => !assertion.tool || assertion.tool === call.logical_name);
}
