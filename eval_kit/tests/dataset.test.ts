import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadDataset } from "../runner/dataset-loader.js";

async function datasetFile(lines: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "eval-dataset-"));
  const path = join(dir, "cases.jsonl");
  await writeFile(path, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
  return path;
}

const base = {
  schema_version: 1,
  suite: "smoke",
  query: "find it",
};

describe("loadDataset", () => {
  it("accepts the task metadata accompanying generated evaluation labels", async () => {
    const loaded = await loadDataset(await datasetFile([{
      ...base, suite: "probe", case_id: "skill-generated", should_call: true, expected_tool_sequence: ["skill_search", "skill_view"],
      scenario_id: "api", asset_path: "dataset/assets/api", source_memory_sessions: ["api-history"], candidate_skills: ["api-guide"],
      expected_skills: ["api-guide"], expected_skill_files: ["references/guide.md"], target_memory_refs: [{ fact_id: "f", session_id: "s", user_message_index: 0, assistant_message_index: 1 }],
    }]));
    expect(loaded.cases[0]?.expected_tool_sequence).toEqual(["skill_search", "skill_view"]);
    expect(loaded.cases[0]?.suite).toBe("probe");
  });
  it("loads first-tool alternatives and ordered sequences without losing their order", async () => {
    const path = await datasetFile([
      { ...base, case_id: "alternatives", should_call: true, allowed_first_tools: ["skill_search", "skill_view"] },
      { ...base, case_id: "sequence", should_call: true, expected_tool_sequence: ["skill_search", "skill_view", "skill_view"] },
      { ...base, case_id: "sequences", should_call: true, allowed_sequences: [["skill_view"], ["skill_search", "skill_view"]] },
    ]);
    const loaded = await loadDataset(path);
    expect(loaded.cases[0]?.allowed_first_tools).toEqual(["skill_search", "skill_view"]);
    expect(loaded.cases[1]?.expected_tool_sequence).toEqual(["skill_search", "skill_view", "skill_view"]);
    expect(loaded.cases[2]?.expected_tools).toEqual(["skill_view", "skill_search"]);
  });

  it("rejects ambiguous selection rules and required calls on a negative case", async () => {
    await expect(loadDataset(await datasetFile([{ ...base, case_id: "ambiguous", should_call: true, allowed_first_tools: ["skill_view"], expected_tool_sequence: ["skill_view"] }]))).rejects.toThrow(/selection rule/i);
    await expect(loadDataset(await datasetFile([{ ...base, case_id: "negative", should_call: false, expected_tool_sequence: ["skill_view"] }]))).rejects.toThrow(/negative.*must not declare/i);
  });
  it("normalizes expected_tool and returns a stable content hash", async () => {
    const path = await datasetFile([
      { ...base, case_id: "positive", should_call: true, expected_tool: "tdai_memory_search" },
      { ...base, case_id: "negative", should_call: false },
    ]);

    const first = await loadDataset(path);
    const second = await loadDataset(path);

    expect(first.cases[0]?.expected_tools).toEqual(["tdai_memory_search"]);
    expect(first.cases[1]?.expected_tools).toEqual([]);
    expect(first.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(second.sha256).toBe(first.sha256);
  });

  it("rejects a positive case without an expected tool", async () => {
    const path = await datasetFile([{ ...base, case_id: "bad-positive", should_call: true }]);
    await expect(loadDataset(path)).rejects.toThrow(/bad-positive.*expected tool/i);
  });

  it("rejects a negative case that declares expected tools", async () => {
    const path = await datasetFile([
      { ...base, case_id: "bad-negative", should_call: false, expected_tools: ["skill_view"] },
    ]);
    await expect(loadDataset(path)).rejects.toThrow(/bad-negative.*must not declare/i);
  });

  it("rejects unsafe case IDs and invalid assertion definitions", async () => {
    await expect(loadDataset(await datasetFile([
      { ...base, case_id: "../escape", should_call: false },
    ]))).rejects.toThrow(/case_id/i);

    await expect(loadDataset(await datasetFile([
      { ...base, case_id: "bad-regex", should_call: false, answer_assertions: [{ operator: "regex", value: "[" }] },
    ]))).rejects.toThrow(/regular expression/i);

    await expect(loadDataset(await datasetFile([
      {
        ...base,
        case_id: "bad-range",
        should_call: true,
        expected_tool: "tdai_memory_search",
        argument_assertions: [{ path: "limit", operator: "range" }],
      },
    ]))).rejects.toThrow(/range/i);
  });
});
