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
  expect(checked.filter(row=>row.final.status==="removed")).toHaveLength(24);
  for (const row of checked) {
    const item=cases.find(c=>c.case_id===row.case_id)!;
    const validation=row.input_validation;
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
    // 删除正式任务不删除实际注入证据；历史记录仍可复查，但不再参与运行。
    if (row.final.status==="removed") {
      expect(item,row.case_id).toBeUndefined();
      expect(row.cleanup.action).toBe("removed");
      expect(row.cleanup.previous_final.tool_family).toBe("skill");
      continue;
    }
    expect(item,row.case_id).toBeDefined();
    expect(row.metadata_corrections.expected_skills,row.case_id).toEqual(item.expected_skills??[]);
    expect(row.metadata_corrections.expected_skill_files,row.case_id).toEqual(item.expected_skill_files??[]);
    expect(validation.reason.length).toBeGreaterThan(15);
    expect(row.final.risks.some((risk:{kind:string})=>risk.kind==="l3_unverified")).toBe(false);
    expect(row.final.status).toBe("reviewed");
    // 已注入历史事实不等于不需要任何工具：相关 Skill 仍按任务本身判断。
    const memoryTools=item.allowed_first_tools?.filter(tool=>tool.startsWith("tdai_")) ?? [];
    // 输入快照是历史证据，不冻结当时的标签；后续逐工具复核允许纠正人为增加的信息缺口。
    if (row.tool_reason_review) {
      expect(row.final.allowed_first_tools).toEqual(item.allowed_first_tools ?? []);
      expect(row.tool_reason_review.previous_final).toBeDefined();
    }
    else if (validation.needs_memory) expect(memoryTools.length,row.case_id).toBeGreaterThan(0);
    else expect(memoryTools,row.case_id).toEqual([]);
  }
});

it("9题首次入口复核保留旧裁定，两组按同一允许列表评分", async () => {
  const root=resolve(import.meta.dirname,"../dataset");
  const {cases}=await loadDataset(resolve(root,"tasks/tool_call_eval_v1.jsonl"));
  const audit=(await readFile(resolve(root,"review/ai-pre-review.jsonl"),"utf8")).trim().split("\n").map(line=>JSON.parse(line));
  const reviewed=audit.filter(row=>row.first_tool_review);
  expect(reviewed).toHaveLength(9);
  const memory=["tdai_memory_search","tdai_conversation_search","tdai_read_scene","tdai_scenario_ls"];
  for (const row of reviewed) {
    const item=cases.find(c=>c.case_id===row.case_id)!;
    const id=row.case_id.split("_")[1];
    const expected=["014","021"].includes(id)
      ? ["tdai_conversation_search","tdai_memory_search","tdai_read_scene"]
      : id==="023" ? [...memory,"skill_view","skill_search"]
      : id==="030" ? memory
      : ["tdai_read_scene","tdai_scenario_ls","tdai_memory_search","tdai_conversation_search"];
    // 标注变更只影响首次入口；旧预审和注入证据不可被新理由覆盖。
    // 新一轮提炼可能把旧信息缺口补进L3；旧裁定保存在快照，不能冻结成永久标签。
    const latestExpected=row.pilot45_review ? row.final.allowed_first_tools : expected;
    if (row.pilot45_review) expect(row.pilot45_review.previous_final.allowed_first_tools).toEqual(expected);
    expect(item.allowed_first_tools,row.case_id).toEqual(latestExpected);
    expect(item.expected_tools).toEqual(latestExpected);
    expect(item.should_call).toBe(true);
    expect(item.tool_family).toBe(row.pilot45_review ? row.final.tool_family : "memory");
    expect(row.first_tool_review.previous_final.status).toBe("reviewed");
    expect(row.first_tool_review.evidence).toHaveLength(3);
    expect(row.final.allowed_first_tools).toEqual(latestExpected);
    expect(row.final.reason).toBe(item.reason);
  }
});
