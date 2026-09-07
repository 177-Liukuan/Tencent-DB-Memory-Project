import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { loadDataset } from "../runner/dataset-loader.js";

const root = resolve(import.meta.dirname, "../dataset");

it("正式允许工具与逐条理由一一对应，不遗留已移除工具的理由", async () => {
  const { cases } = await loadDataset(resolve(root, "tasks/tool_call_eval_v1.jsonl"));
  for (const task of cases) {
    const lines = (task.reason ?? "").split("\n");
    const entries = lines.map(line => /^- `([^`]+)`：(.+)$/.exec(line)).filter(match => match !== null);
    expect(entries.map(entry => entry[1]), task.case_id).toEqual(task.allowed_first_tools ?? []);
    expect(new Set(entries.map(entry => entry[1])).size, task.case_id).toBe(entries.length);
    expect(task.expected_tools, task.case_id).toEqual(task.allowed_first_tools ?? []);
    for (const entry of entries) expect(entry[2]!.length, task.case_id).toBeGreaterThan(30);
    if (!task.should_call) expect(task.reason, task.case_id).toMatch(/Memory.*Skill/s);
  }
});

it("新增30题有独立资产和来源，不复活删除任务或复制旧Query", async () => {
  const { cases } = await loadDataset(resolve(root, "tasks/tool_call_eval_v1.jsonl"));
  const added = cases.filter(task => task.case_id.startsWith("memory_") && Number(task.case_id.split("_")[1]) >= 101);
  expect(added).toHaveLength(30);
  expect(new Set(cases.map(task => task.query)).size).toBe(cases.length);
  expect(new Set(added.map(task => task.asset_path)).size).toBe(30);
  for (const task of added) {
    expect(task.tool_family).toBe("memory");
    expect(task.source_memory_sessions?.length).toBeGreaterThan(0);
    expect(task.target_memory_refs?.length).toBeGreaterThan(0);
    const readme = await readFile(resolve(root, "..", task.asset_path!, "README.md"), "utf8");
    expect(readme).not.toContain(task.case_id);
    expect(readme).not.toContain(task.reason!);
  }
});
