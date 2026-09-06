import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createViewerApp } from "../viewer/server.js";
import { loadDataset } from "../runner/dataset-loader.js";
import { readReviewCatalog } from "../viewer/review.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
const task = { schema_version: 1, case_id: "task_a", suite: "main", query: "查询项目约定", should_call: true,
  tool_family: "memory", allowed_first_tools: ["tdai_memory_search"], tags: ["保留标签"] };
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "viewer-review-")); roots.push(root);
  const datasetPath = join(root, "tasks.jsonl");
  const original = JSON.stringify(task) + "\n";
  await writeFile(datasetPath, original);
  const app = createViewerApp({ resultsRoot: join(root, "results"), datasetPath });
  const request = (path: string, body: unknown, method = "POST", origin?: string) => app.request(path, {
    method, headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body),
  });
  const current = async () => (await app.request("/api/review")).json();
  return { root, datasetPath, original, app, request, current };
}

describe("人工审查数据写回", () => {
  it("说明来自文件内容而非代码常量，保留转义竖线", async () => {
    const f = await fixture(), path = join(f.root, "tools.md");
    await writeFile(path, "## 1. Memory Proxy Tool\n| `custom_read` | 完整描述 A \\| B | 简明用途 |\n");
    expect(await readReviewCatalog(path)).toEqual([{ name: "custom_read", description: "完整描述 A | B", summary: "简明用途", kind: "tool", enabled: true, group: "1. Memory Proxy Tool" }]);
    await writeFile(path, "## 1. Memory Proxy Tool\n| `custom_read` | 新描述 | 新用途 |\n");
    expect((await readReviewCatalog(path))[0]?.summary).toBe("新用途");
  });
  it("两个实例同时保存最多一份成功，不会互相覆盖", async () => {
    const f = await fixture(), before = await f.current();
    const other = createViewerApp({ resultsRoot: f.root, datasetPath: f.datasetPath });
    const responses = await Promise.all([f.request("/api/review/tasks/task_a", { task: { ...task, reason: "第一份" }, revision: before.revision }, "PUT"),
      other.request("/api/review/tasks/task_a", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: { ...task, reason: "第二份" }, revision: before.revision }) })]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await readdir(join(f.root, ".review-backups"))).toHaveLength(1);
  });
  it("拒绝理由类型错误和相互冲突的标签，原数据不变", async () => {
    const f = await fixture(), { revision } = await f.current();
    for (const updated of [{ ...task, reason: 3 }, { ...task, should_call: false }, { ...task, expected_tool_sequence: ["tdai_atomic_query"] }, { ...task, tool_family: "none" }]) {
      expect((await f.request("/api/review/tasks/task_a", { task: updated, revision }, "PUT")).status).toBe(422);
      expect(await readFile(f.datasetPath, "utf8")).toBe(f.original);
    }
  });
  it("从文档提供人话与原始说明，并区分工具、未开放工具和 Skill", async () => {
    const { app } = await fixture();
    const response = await app.request("/api/review");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0]).toEqual(task);
    expect(body.catalog.find((t: {name:string}) => t.name === "tdai_read_scene")).toMatchObject({ kind: "tool", enabled: true });
    expect(body.catalog.find((t: {name:string}) => t.name === "skill_delete")).toMatchObject({ kind: "tool", enabled: false });
    expect(body.catalog.find((t: {name:string}) => t.name === "browser-use")).toMatchObject({ kind: "skill" });
    const search = body.catalog.find((t: {name:string}) => t.name === "tdai_memory_search");
    expect(search.description).toContain("L1"); expect(search.summary).toContain("偏好");
  });
  it("保存 reason 与其他字段，备份原文件且 Runner 可以读取新数据", async () => {
    const f = await fixture(); const before = await f.current();
    const updated = { ...task, query: "新的问题", reason: "项目约定不在本地，需要查询历史。" };
    const res = await f.request("/api/review/tasks/task_a", { task: updated, revision: before.revision }, "PUT");
    expect(res.status).toBe(200);
    expect(JSON.parse(await readFile(f.datasetPath, "utf8"))).toEqual(updated);
    const files = await readdir(join(f.root, ".review-backups")); expect(files).toHaveLength(1);
    expect(await readFile(join(f.root, ".review-backups", files[0]!), "utf8")).toBe(f.original);
    expect((await loadDataset(f.datasetPath)).cases[0]).toMatchObject({ reason: updated.reason, tags: task.tags });
    expect((await f.current()).revision).not.toBe(before.revision);
  });
  it("旧页面不能覆盖新修改", async () => {
    const f = await fixture(); const before = await f.current();
    await f.request("/api/review/tasks/task_a", { task: { ...task, reason: "先保存" }, revision: before.revision }, "PUT");
    const res = await f.request("/api/review/tasks/task_a", { task, revision: before.revision }, "PUT");
    expect(res.status).toBe(409); expect((await f.current()).items[0].reason).toBe("先保存");
  });
  it.each([JSON.stringify({ ...task, case_id: "task_b" }), JSON.stringify([{ ...task, case_id: "task_b" }]),
    JSON.stringify({ ...task, case_id: "task_b" }) + "\n" + JSON.stringify({ ...task, case_id: "task_c" })])("单条、JSON 数组和 JSONL 先预览后导入：%s", async content => {
    const f = await fixture(); const before = await f.current();
    const body = { content, revision: before.revision, replaceExisting: false, preview: true };
    const preview = await f.request("/api/review/import", body); expect(preview.status).toBe(200);
    expect(await readFile(f.datasetPath, "utf8")).toBe(f.original);
    const res = await f.request("/api/review/import", { ...body, preview: false }); expect(res.status).toBe(200);
    expect((await f.current()).items.some((t:{case_id:string}) => t.case_id === "task_b")).toBe(true);
  });
  it("重号默认拒绝，只有明确开启替换才更新", async () => {
    const f = await fixture(); const { revision } = await f.current();
    const body = { content: JSON.stringify({ ...task, reason: "已核对" }), revision, preview: false, replaceExisting: false };
    expect((await f.request("/api/review/import", body)).status).toBe(409);
    expect((await f.request("/api/review/import", { ...body, replaceExisting: true })).status).toBe(200);
    expect((await f.current()).items).toHaveLength(1);
  });
  it("批量中任一错误都不落盘，包括重复 ID", async () => {
    const f = await fixture(); const { revision } = await f.current();
    for (const values of [[{ ...task, case_id: "b" }, { ...task, query: "" }], [task, task]]) {
      expect((await f.request("/api/review/import", { content: JSON.stringify(values), revision, preview: false, replaceExisting: true })).status).toBe(422);
      expect(await readFile(f.datasetPath, "utf8")).toBe(f.original);
    }
  });
  it.each(["skill_delete", "browser-use", "unknown_tool"])("不接受未开放或非工具的选择：%s", async name => {
    const f = await fixture(); const { revision } = await f.current();
    const res = await f.request("/api/review/tasks/task_a", { task: { ...task, allowed_first_tools: [name] }, revision }, "PUT");
    expect(res.status).toBe(422); expect(await readFile(f.datasetPath, "utf8")).toBe(f.original);
  });
  it("原有 Probe 序列与缺少 reason 的数据可以无损保存", async () => {
    const f = await fixture(); const { revision } = await f.current();
    const { allowed_first_tools, ...rest } = task;
    const probe = { ...rest, suite: "probe", expected_tool_sequence: ["tdai_scenario_ls", "tdai_read_scene"] };
    expect((await f.request("/api/review/tasks/task_a", { task: probe, revision }, "PUT")).status).toBe(200);
    expect(JSON.parse(await readFile(f.datasetPath, "utf8"))).toEqual(probe);
  });
  it("拒绝跨站写请求和更改已有任务 ID", async () => {
    const f = await fixture(); const { revision } = await f.current();
    expect((await f.request("/api/review/tasks/task_a", { task, revision }, "PUT", "https://evil.test")).status).toBe(403);
    expect((await f.request("/api/review/tasks/task_a", { task: { ...task, case_id: "renamed" }, revision }, "PUT")).status).toBe(422);
    expect(await readFile(f.datasetPath, "utf8")).toBe(f.original);
  });
});
