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
