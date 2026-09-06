// 浏览器测试只操作临时数据，不改动正式数据集。
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createViewerApp } from "../viewer/server.js";
const directory = await mkdtemp(join(tmpdir(), "review-browser-"));
const datasetPath = join(directory, "tasks.jsonl");
await writeFile(datasetPath, [
  { schema_version: 1, case_id: "task_a", suite: "main", query: "查询以前的约定", should_call: true, tool_family: "memory", allowed_first_tools: ["tdai_memory_search"], tags: ["保留元数据"] },
  { schema_version: 1, case_id: "task_b", suite: "probe", query: "读取场景", should_call: true, tool_family: "memory", expected_tool_sequence: ["tdai_scenario_ls", "tdai_read_scene"] },
].map(t => JSON.stringify(t)).join("\n") + "\n");
const server = serve({ fetch: createViewerApp({ resultsRoot: directory, datasetPath }).fetch, hostname: "127.0.0.1", port: 4175 });
console.log("Review browser fixture: http://127.0.0.1:4175/?view=review");
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { server.close(() => { void rm(directory, { recursive: true, force: true }).then(() => process.exit(0)); }); });
