import { isDeepStrictEqual } from "node:util";

import type { ArgumentAssertion, ToolCallRecord } from "../types.js";

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
