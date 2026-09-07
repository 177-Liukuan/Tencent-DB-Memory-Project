import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { loadDataset } from "../runner/dataset-loader.js";

const root = resolve(import.meta.dirname, "../dataset");
const jsonl = async (file: string) => (await readFile(resolve(root, file), "utf8")).trim().split("\n").map(line => JSON.parse(line));

it("45题真实输入复核保留旧标签、双组证据和逐工具理由", async () => {
  const review = await jsonl("review/pilot-45-label-review.jsonl");
  const audit = await jsonl("review/ai-pre-review.jsonl");
  const { cases } = await loadDataset(resolve(root, "tasks/tool_call_eval_v1.jsonl"));
  expect(review).toHaveLength(45);
  expect(new Set(review.map(row => row.case_id)).size).toBe(45);
  for (const row of review) {
    const task = cases.find(item => item.case_id === row.case_id)!;
    const history = audit.find(item => item.case_id === row.case_id);
    expect(task, row.case_id).toBeDefined();
    expect(row.query).toBe(task.query);
    expect(row.final_label.reason).toBe(task.reason);
    expect(row.final_label.allowed_first_tools).toEqual(task.allowed_first_tools ?? []);
    expect(Object.keys(row.per_tool_reasons)).toEqual(task.allowed_first_tools ?? []);
    expect(history.pilot45_review.previous_final).toBeDefined();
    expect(history.pilot45_review.previous_task.reason).toBe(row.previous_label.reason);
    expect(history.final.reason).toBe(task.reason);
    expect(row.inputs.map((input: {variant: string}) => input.variant)).toEqual(["baseline", "native"]);
    for (const input of row.inputs) {
      expect(input.trace_id.length).toBeGreaterThan(0);
      expect(input.observation_id.length).toBeGreaterThan(0);
    }
    // 两组共用一个标签；无效采集不能因没有调用而被算作正确负例。
    for (const observation of row.observations) {
      if (!observation.observation_valid) expect(observation.verdict).toBe("采集无效，不评分");
      else if (task.should_call && observation.actual_tools.length) {
        expect(observation.verdict === "首调入口符合").toBe(task.allowed_first_tools!.includes(observation.actual_tools[0]));
      }
    }
  }
});

it("只解除新增30题中有真实输入记录的7题，其他23题仍待确认", async () => {
  const authored = (await jsonl("review/ai-pre-review.jsonl")).filter(row => row.review_type === "authored_in_current_session");
  expect(authored.filter(row => row.pilot45_review)).toHaveLength(7);
  expect(authored.filter(row => row.final.status === "needs_confirmation")).toHaveLength(23);
  for (const row of authored.filter(row => row.pilot45_review)) {
    expect(row.independent_review).toBeUndefined();
    expect(row.final.status).toBe("reviewed");
    expect(row.pilot45_review.inputs).toHaveLength(2);
  }
});
