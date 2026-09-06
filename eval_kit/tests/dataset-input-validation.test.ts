import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { loadDataset } from "../runner/dataset-loader.js";

it("62条实际注入复核保留双组证据，标签不再假定目标信息必然隐藏", async () => {
  const root=resolve(import.meta.dirname,"../dataset");
  const {cases}=await loadDataset(resolve(root,"tasks/tool_call_eval_v1.jsonl"));
  const audit=(await readFile(resolve(root,"review/ai-pre-review.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
  const checked=audit.filter(row=>row.input_validation?.experiment_id==="pilot-2026-09-06T19-47-50-494Z");
  expect(checked).toHaveLength(62);
  for (const row of checked) {
    const item=cases.find(c=>c.case_id===row.case_id)!;
    const validation=row.input_validation;
    expect(item,row.case_id).toBeDefined();
    expect(validation.variants_match,row.case_id).toBe(true);
    expect(validation.inputs.map((input:{variant:string})=>input.variant)).toEqual(["baseline","native"]);
    for (const input of validation.inputs) {
      expect(input.observation_id.length).toBeGreaterThan(0);
      expect(input.memory_sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(validation.injected_memory).toContain("<l3_core_memory>");
    expect(validation.injected_memory).toContain("<l2_scene_index>");
    expect(validation.skill_catalog.names).toHaveLength(15);
    expect(validation.skill_catalog.matched).toBe(true);
    expect(validation.previous_final.status).toBe("needs_confirmation");
    expect(row.metadata_corrections.expected_skills,row.case_id).toEqual(item.expected_skills??[]);
    expect(row.metadata_corrections.expected_skill_files,row.case_id).toEqual(item.expected_skill_files??[]);
    expect(validation.reason.length).toBeGreaterThan(15);
    expect(row.final.risks.some((risk:{kind:string})=>risk.kind==="l3_unverified")).toBe(false);
    expect(row.final.status).toBe("reviewed");
    // 已注入历史事实不等于不需要任何工具：相关 Skill 仍按任务本身判断。
    const memoryTools=item.allowed_first_tools?.filter(tool=>tool.startsWith("tdai_")) ?? [];
    if (validation.needs_memory) expect(memoryTools.length,row.case_id).toBeGreaterThan(0);
    else expect(memoryTools,row.case_id).toEqual([]);
  }
});
