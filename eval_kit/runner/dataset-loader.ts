import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

import { z } from "zod";

import type { EvalCase } from "../types.js";

const answerAssertionSchema = z.object({
  operator: z.enum(["exact", "contains", "regex"]),
  value: z.string(),
  flags: z.string().optional(),
}).superRefine((value, context) => {
  if (value.operator !== "regex") return;
  try { new RegExp(value.value, value.flags); } catch {
    context.addIssue({ code: "custom", message: "Invalid regular expression" });
  }
});

const argumentAssertionSchema = z.object({
  tool: z.string().min(1).optional(),
  path: z.string().min(1),
  operator: z.enum(["exists", "equals", "contains", "regex", "range"]),
  value: z.unknown().optional(),
  flags: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
}).superRefine((value, context) => {
  if (["equals", "contains", "regex"].includes(value.operator) && value.value === undefined) {
    context.addIssue({ code: "custom", message: `${value.operator} requires value` });
  }
  if (value.operator === "exists" && value.value !== undefined && typeof value.value !== "boolean") {
    context.addIssue({ code: "custom", message: "exists value must be boolean" });
  }
  if (value.operator === "range") {
    if (value.min === undefined && value.max === undefined) context.addIssue({ code: "custom", message: "range requires min or max" });
    if (value.min !== undefined && value.max !== undefined && value.min > value.max) context.addIssue({ code: "custom", message: "range min must not exceed max" });
  }
  if (value.operator === "regex" && typeof value.value === "string") {
    try { new RegExp(value.value, value.flags); } catch {
      context.addIssue({ code: "custom", message: "Invalid regular expression" });
    }
  }
});

const caseSchema = z.object({
  schema_version: z.literal(1),
  case_id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u, "case_id must be a safe identifier"),
  suite: z.enum(["smoke", "main", "reliability", "probe"]),
  query: z.string().min(1),
  should_call: z.boolean(),
  expected_tool: z.string().min(1).nullable().optional(),
  expected_tools: z.array(z.string().min(1)).optional(),
  allowed_first_tools: z.array(z.string().min(1)).min(1).optional(),
  expected_tool_sequence: z.array(z.string().min(1)).optional(),
  allowed_sequences: z.array(z.array(z.string().min(1)).min(1)).min(1).optional(),
  argument_assertions: z.array(argumentAssertionSchema).optional(),
  answer_assertions: z.array(answerAssertionSchema).optional(),
  tool_family: z.enum(["memory", "skill", "knowledge", "none"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  tags: z.array(z.string()).optional(),
  // 数据构建器附带的素材来源只作为元数据保留，不参与工具选择计分。
  scenario_id: z.string().optional(),
  asset_path: z.string().nullable().optional(),
  source_memory_sessions: z.array(z.string()).optional(),
  // 保留旧数据字段以便读回历史任务；不再参与 Skill 导入或模型输入构造。
  candidate_skills: z.array(z.string()).optional(),
  expected_skills: z.array(z.string()).optional(),
  expected_skill_files: z.array(z.string()).optional(),
  target_memory_refs: z.array(z.object({ fact_id: z.string(), session_id: z.string(), user_message_index: z.number().int().nonnegative(), assistant_message_index: z.number().int().nonnegative() })).optional(),
}).strict();

export type LoadedDataset = {
  path: string;
  sha256: string;
  cases: EvalCase[];
};

export async function loadDataset(path: string): Promise<LoadedDataset> {
  const raw = await readFile(path, "utf8");
  const cases: EvalCase[] = [];
  const seen = new Set<string>();
  for (const [index, source] of raw.split(/\r?\n/u).entries()) {
    if (!source.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch (error) {
      throw new Error(`Dataset line ${index + 1} is not valid JSON: ${String(error)}`);
    }
    const value = caseSchema.parse(parsed);
    if (seen.has(value.case_id)) throw new Error(`Duplicate case_id: ${value.case_id}`);
    seen.add(value.case_id);
    const selectionRules = [value.allowed_first_tools, value.expected_tool_sequence?.length ? value.expected_tool_sequence : undefined, value.allowed_sequences].filter(Boolean);
    if (selectionRules.length > 1) throw new Error(`Case ${value.case_id}: declare only one selection rule`);
    const expectedTools = [...new Set([
      ...(value.expected_tools ?? []),
      ...(value.expected_tool ? [value.expected_tool] : []),
      ...(value.allowed_first_tools ?? []),
      ...(value.expected_tool_sequence ?? []),
      ...(value.allowed_sequences?.flat() ?? []),
    ])];
    if (value.should_call && expectedTools.length === 0) {
      throw new Error(`Case ${value.case_id}: a positive case requires at least one expected tool`);
    }
    if (!value.should_call && expectedTools.length > 0) {
      throw new Error(`Case ${value.case_id}: a negative case must not declare expected tools`);
    }
    if (!value.should_call && (value.argument_assertions?.length ?? 0) > 0) {
      throw new Error(`Case ${value.case_id}: a negative case must not declare argument assertions`);
    }
    for (const assertion of value.argument_assertions ?? []) {
      if (assertion.tool && !expectedTools.includes(assertion.tool)) {
        throw new Error(`Case ${value.case_id}: argument assertion references undeclared tool ${assertion.tool}`);
      }
    }
    cases.push({ ...value, expected_tools: expectedTools } as EvalCase);
  }
  if (cases.length === 0) throw new Error(`Dataset ${path} has no cases`);
  return {
    path,
    sha256: createHash("sha256").update(raw).digest("hex"),
    cases,
  };
}
