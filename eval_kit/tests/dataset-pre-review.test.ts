import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadDataset } from "../runner/dataset-loader.js";

const datasetRoot = resolve(import.meta.dirname, "../dataset");

describe("逐题改写与独立预审交付", () => {
  it("每条正式任务都有理由，并采用首调而非旧 Probe 序列", async () => {
    const { cases } = await loadDataset(resolve(datasetRoot, "tasks/tool_call_eval_v1.jsonl"));
    expect(cases.length).toBeGreaterThan(0);
    for (const item of cases) {
      expect(item.suite, item.case_id).toBe("main");
      expect(item.reason?.trim().length ?? 0, item.case_id).toBeGreaterThan(15);
      expect(item.expected_tool_sequence?.length ?? 0, item.case_id).toBe(0);
      expect(item.allowed_sequences, item.case_id).toBeUndefined();
      if (item.should_call) expect(item.allowed_first_tools?.length, item.case_id).toBeGreaterThan(0);
      else expect(item.expected_tools, item.case_id).toEqual([]);
    }
  });

  it("独立预审和最终裁定一一对应，不能用旧标签冒充预审结论", async () => {
    const { cases } = await loadDataset(resolve(datasetRoot, "tasks/tool_call_eval_v1.jsonl"));
    const raw = await readFile(resolve(datasetRoot, "review/ai-pre-review.jsonl"), "utf8");
    const rows = raw.trim().split("\n").map(line => JSON.parse(line));
    // 旧300题的独立预审原样保留；新增题明确采用本轮同会话编写/自审，不伪造盲审证据。
    const authored = rows.filter(row => row.review_type === "authored_in_current_session");
    expect(rows.length - authored.length).toBe(300);
    expect(authored).toHaveLength(30);
    expect(new Set(rows.map(row => row.review_id)).size).toBe(rows.length);
    expect(new Set(rows.map(row => row.case_id)).size).toBe(rows.length);
    const removed = rows.filter(row => row.final.status === "removed");
    expect(cases.length + removed.length).toBe(rows.length);
    for (const row of removed) {
      expect(cases.some(item => item.case_id === row.case_id)).toBe(false);
      expect(row.cleanup.reason.length).toBeGreaterThan(0);
      expect(row.cleanup.previous_final).toBeDefined();
    }
    for (const item of cases) {
      const row = rows.find(row => row.case_id === item.case_id);
      expect(row, item.case_id).toBeDefined();
      expect(row.review_id).toMatch(/^review-\d{3}$/);
      expect(row.rewritten_query).toBe(item.query);
      if (row.review_type === "authored_in_current_session") {
        expect(row.independent_review).toBeUndefined();
        // 后续真实输入复核不等于重新做过盲审；只解除有双组证据的待确认项。
        expect(row.final.status).toBe(row.pilot45_review ? "reviewed" : "needs_confirmation");
        expect(row.final.reason).toBe(item.reason);
        expect(row.final.allowed_first_tools).toEqual(item.allowed_first_tools);
        expect(row.source_design.decision.length).toBeGreaterThan(20);
        expect(row.final.risks.some((risk: {kind:string}) => risk.kind === "l3_unverified")).toBe(!row.pilot45_review);
        continue;
      }
      expect(row.independent_review.reason.length).toBeGreaterThan(15);
      expect(row.independent_review.evidence.length).toBeGreaterThan(0);
      expect(row.review_input_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.review_input_manifest.review_id).toBe(row.review_id);
      expect(row.review_input_manifest.query).toBe(row.initial_rewritten_query);
      // 完整审核记录可以保存旧标签，但交给独立预审者的材料清单不能包含它们。
      const blindInput = JSON.stringify(row.review_input_manifest);
      expect(blindInput).not.toMatch(/"(?:tool_family|should_call|allowed_first_tools|expected_skills|target_memory_refs|reason)"/);
      expect(blindInput).not.toMatch(/\b(?:memory|skill|none)_\d{3}_/);
      if (row.re_review) expect(row.re_review_input_sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(row.reviewer_context).not.toBe(row.writer_context);
      expect(row.final.reason).toBe(item.reason);
      expect(row.final.tool_family).toBe(item.tool_family);
      expect(row.final.should_call).toBe(item.should_call);
      expect(row.final.allowed_first_tools).toEqual(item.allowed_first_tools ?? []);
      expect(["reviewed", "needs_confirmation"]).toContain(row.final.status);
      expect(row.comparison).toBeDefined();
    }
  });
});
