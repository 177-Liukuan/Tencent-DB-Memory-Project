import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createViewerApp } from "../viewer/server.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
const base = { schema_version: 1, suite: "main", query: "请检查代码" };
const samples = [
  { ...base, case_id: "memory-a", should_call: true, expected_tool: "tdai_memory_search", tool_family: "memory", difficulty: "easy", scenario_id: "api", asset_path: "assets/api", source_memory_sessions: ["history"], candidate_skills: ["guide"] },
  { ...base, case_id: "skill-a", query: "<img src=x onerror=alert(1)>", should_call: true, expected_tool_sequence: ["skill_search", "skill_view", "skill_view"], tool_family: "skill", difficulty: "hard", scenario_id: "api", asset_path: "assets/api", expected_skills: ["guide"], candidate_skills: ["guide"], expected_skill_files: ["references/a.md"] },
  { ...base, case_id: "none-a", should_call: false, tool_family: "none", difficulty: "medium", scenario_id: "cli" },
  { ...base, case_id: "unlabeled", should_call: false },
];
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "viewer-dataset-")); roots.push(root);
  const datasetPath = join(root, "tasks.jsonl");
  const save = (values: unknown[]) => writeFile(datasetPath, values.map(value => JSON.stringify(value)).join("\n"));
  await save(samples);
  return { root, datasetPath, save, app: createViewerApp({ resultsRoot: join(root, "no-experiments"), datasetPath }) };
}

describe("dataset viewer API", () => {
  it("counts dataset cases independently of experiment results and deduplicates tool coverage per case", async () => {
    const { app } = await fixture();
    const response = await app.request("/api/dataset");
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.summary).toEqual({ tasks: 4, positive: 2, negative: 2, scenarios: 2, assets: 1, memory_sessions: 1, skills: 1 });
    expect(data.distributions.families).toEqual([{ name: "none", count: 2 }, { name: "memory", count: 1 }, { name: "skill", count: 1 }]);
    expect(data.distributions.tools).toContainEqual({ name: "skill_view", count: 1 });
    expect(data.distributions.scenarios).toContainEqual({ name: "api", count: 2 });
    expect(data.items.find((item: { case_id: string }) => item.case_id === "skill-a")).toMatchObject({
      query: "<img src=x onerror=alert(1)>", expected_tool_sequence: ["skill_search", "skill_view", "skill_view"], expected_skill_files: ["references/a.md"],
    });
    expect(data.source.name).toBe("tasks.jsonl");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await (await app.request("/api/experiments")).json()).toEqual([]);
  });

  it("reflects edited source data on refresh, without writing the dataset", async () => {
    const { app, save } = await fixture();
    await app.request("/api/dataset");
    await save([samples[0]]);
    expect((await (await app.request("/api/dataset")).json()).summary.tasks).toBe(1);
  });

  it("双入口按列表派生，保留原主要需求元数据", async () => {
    const { app, save } = await fixture();
    await save([{ ...base, case_id: "memory_a", tool_family: "skill", should_call: true,
      allowed_first_tools: ["tdai_memory_search", "skill_view"] }]);
    const data = await (await app.request("/api/dataset")).json();
    expect(data.distributions.families).toEqual([{ name: "mixed", count: 1 }]);
    expect(data.items[0]).toMatchObject({ task_group: "mixed", tool_family: "skill" });
  });

  it("does not accept a filesystem path from the browser", async () => {
    const { app, root } = await fixture();
    await writeFile(join(root, "secret.jsonl"), "PRIVATE");
    const response = await app.request("/api/dataset?path=secret.jsonl");
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("PRIVATE");
    expect((await app.request("/api/dataset/../../secret.jsonl")).status).toBeGreaterThanOrEqual(400);
  });

  it.each(["{bad", "", JSON.stringify(samples[0]) + "\n" + JSON.stringify(samples[0])])("reports invalid data instead of displaying partial counts", async (content) => {
    const { app, datasetPath } = await fixture();
    await writeFile(datasetPath, content);
    expect((await app.request("/api/dataset")).status).toBe(422);
  });

  it("reports missing files without exposing server paths", async () => {
    const { root } = await fixture();
    const app = createViewerApp({ resultsRoot: root, datasetPath: join(root, "missing.jsonl") });
    const response = await app.request("/api/dataset");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain(root);
  });
});
