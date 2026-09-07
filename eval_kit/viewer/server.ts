import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { readManifest, readOverview, readRun, viewerConfigSchema } from "./results.js";
import { readDatasetOverview } from "./dataset.js";
import { readReview, changeReview, parseImport } from "./review.js";
import { taskGroup } from "../metrics/task-group.js";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { EvalCase } from "../types.js";

export function resolveWithin(root: string, child: string): string {
  if (child.includes("\0") || isAbsolute(child)) throw new Error("Path points outside the results root");
  const base = resolve(root);
  const candidate = resolve(base, child);
  if (candidate !== base && !candidate.startsWith(`${base}${sep}`)) throw new Error("Path points outside the results root");
  return candidate;
}

async function resolveExistingWithin(root: string, child: string): Promise<string> {
  const candidate = resolveWithin(root, child);
  const [base, actual] = await Promise.all([realpath(root), realpath(candidate)]);
  if (actual !== base && !actual.startsWith(`${base}${sep}`)) throw new Error("Path points outside the results root");
  return actual;
}

async function jsonFile(root: string, child: string): Promise<unknown> {
  return JSON.parse(await readFile(await resolveExistingWithin(root, child), "utf8"));
}

export function createViewerApp(options: { resultsRoot: string; datasetPath?: string }): Hono {
  const app = new Hono();
  const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "public");
  const datasetPath = options.datasetPath ?? resolve(publicRoot, "../../dataset/tasks/tool_call_eval_v1.jsonl");
  const catalogPath = resolve(publicRoot, "../../dataset/可供选择的工具.md");

  app.use("*", async (c, next) => {
    await next();
    c.header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    c.header("referrer-policy", "no-referrer");
    c.header("x-content-type-options", "nosniff");
    c.header("cache-control", "no-store");
  });
  app.onError((error, c) => c.json({ error: error instanceof HTTPException ? error.message : "无法读取结果，请检查目录权限或文件是否完整。" }, error instanceof HTTPException ? error.status : 500));
  function identifier(value: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/u.test(value)) throw new HTTPException(400, { message: "无效的实验或运行编号。" });
    return value;
  }
  function reader(experiment: string) {
    identifier(experiment);
    return async (child: string) => {
      try { return await jsonFile(options.resultsRoot, `${experiment}/${child}`); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HTTPException(404, { message: "结果尚未生成或不存在。" });
        if (error instanceof SyntaxError) throw new HTTPException(422, { message: "结果文件不是有效 JSON。" });
        throw error;
      }
    };
  }
  async function config(experiment: string) {
    const parsed = viewerConfigSchema.safeParse(await reader(experiment)("config.json"));
    if (!parsed.success) throw new HTTPException(422, { message: "Viewer 只读取当前 Bridge 观测格式（version: 2）。" });
    // 准备目录也可能保存一份配置，但它不是配置所指的正式结果目录。
    if (parsed.data.experiment_id !== experiment) throw new HTTPException(422, { message: "该目录不是配置对应的实验结果目录。" });
    return parsed.data;
  }
  app.get("/api/experiments", async (c) => {
    const entries = await readdir(options.resultsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
    const experiments: Array<{ experiment_id: string; model: string; updated_at: string }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        const current = await config(entry.name);
        const info = await stat(await resolveExistingWithin(options.resultsRoot, `${entry.name}/config.json`));
        experiments.push({ experiment_id: entry.name, model: current.model, updated_at: info.mtime.toISOString() });
      } catch { /* 结果目录也存放准备材料和旧实验，只列出有效的新格式配置。 */ }
    }
    return c.json(experiments.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.experiment_id.localeCompare(b.experiment_id)));
  });
  // 浏览器只能读取启动时确定的任务文件，不提供任意文件路径读取接口。
  app.get("/api/dataset", async (c) => c.json(await readDatasetOverview(datasetPath)));
  app.use("/api/review/*", bodyLimit({ maxSize: 8 * 1024 * 1024, onError: c => c.json({ error: "导入内容不能超过 8 MiB。" }, 413) }));
  app.use("/api/review/*", async (c, next) => {
    if (c.req.method !== "GET") {
      // JSON 写接口拒绝跨站请求；浏览器不能借本机 Viewer 改写任务文件。
      const origin = c.req.header("origin");
      if ((origin && origin !== new URL(c.req.url).origin) || c.req.header("sec-fetch-site") === "cross-site") {
        throw new HTTPException(403, { message: "不允许跨站修改数据集。" });
      }
      if (!c.req.header("content-type")?.startsWith("application/json")) throw new HTTPException(415, { message: "请使用 JSON 请求。" });
    }
    await next();
  });
  app.get("/api/review", async c => c.json(await readReview(datasetPath, catalogPath)));
  // 仅预览派生分组，不写文件；审核界面和评分共享同一个判断。
  app.post("/api/review/task-group", async c => {
    const rules = z.object({ should_call: z.boolean(), expected_tools: z.array(z.string()).default([]),
      expected_tool: z.string().optional(), allowed_first_tools: z.array(z.string()).optional(),
      allowed_sequences: z.array(z.array(z.string())).optional(), expected_tool_sequence: z.array(z.string()).optional() });
    try {
      const value = rules.parse(await c.req.json());
      return c.json({ task_group: taskGroup({ should_call: value.should_call,
        expected_tools: value.expected_tools.length ? value.expected_tools : value.expected_tool ? [value.expected_tool] : [],
        ...(value.allowed_first_tools ? { allowed_first_tools: value.allowed_first_tools } : {}),
        ...(value.allowed_sequences ? { allowed_sequences: value.allowed_sequences } : {}),
        ...(value.expected_tool_sequence ? { expected_tool_sequence: value.expected_tool_sequence } : {}) }) });
    } catch { throw new HTTPException(422, { message: "请先设置有效的 Memory / Skill 入口规则。" }); }
  });
  const editSchema = z.object({ revision: z.string().min(1), task: z.record(z.string(), z.unknown()) }).strict();
  const importSchema = z.object({ revision: z.string().min(1), content: z.string().min(1), replaceExisting: z.boolean(), preview: z.boolean() }).strict();
  app.put("/api/review/tasks/:id", async c => {
    const result = editSchema.safeParse(await c.req.json().catch(() => null));
    if (!result.success) throw new HTTPException(422, { message: "保存请求格式错误。" });
    return c.json(await changeReview(datasetPath, catalogPath, { revision: result.data.revision,
      items: [result.data.task as EvalCase], editingId: c.req.param("id"), replaceExisting: true, preview: false }));
  });
  app.post("/api/review/import", async c => {
    const result = importSchema.safeParse(await c.req.json().catch(() => null));
    if (!result.success) throw new HTTPException(422, { message: "导入请求格式错误。" });
    return c.json(await changeReview(datasetPath, catalogPath, { ...result.data, items: parseImport(result.data.content) }));
  });
  app.get("/api/experiments/:experiment/overview", async (c) => {
    const experiment = c.req.param("experiment");
    const current = await config(experiment);
    return c.json({ experiment_id: experiment, model: current.model, measurement: current.measurement,
      ...await readOverview(reader(experiment), c.req.query("suite")) });
  });
  app.get("/api/experiments/:experiment/runs/:run", async (c) => {
    const experiment = c.req.param("experiment");
    const run = c.req.param("run");
    identifier(run);
    await config(experiment);
    const read = reader(experiment);
    const row = (await readManifest(read)).find(r => r.run_id === run);
    if (!row) return c.json({ error: "该运行不在实验清单中。" }, 404);
    const result = await readRun(read, row);
    // 标签依据取实验冻结的任务，不用当前数据集覆盖当时的判断理由。
    let reason: string | null = null;
    try {
      const path = await resolveExistingWithin(options.resultsRoot, `preparation/${experiment}/cases.jsonl`);
      const tasks = (await readFile(path, "utf8")).split(/\r?\n/u).filter(line => line.trim()).map(line => JSON.parse(line));
      const task = tasks.find(item => item.case_id === row.case_id);
      if (typeof task?.reason === "string") reason = task.reason;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return c.json({ ...result, reason });
  });
  app.get("/assets/:name", async (c) => {
    const name = c.req.param("name");
    if (!/^[A-Za-z0-9._-]+$/u.test(name)) return c.text("Invalid asset", 400);
    const path = await resolveExistingWithin(publicRoot, name);
    const info = await stat(path);
    if (!info.isFile()) return c.text("Not found", 404);
    const type = name.endsWith(".js") ? "text/javascript; charset=utf-8" : name.endsWith(".css") ? "text/css; charset=utf-8" : "application/octet-stream";
    return c.body(await readFile(path), 200, { "content-type": type, "cache-control": "no-store" });
  });
  app.all("/api/*", (c) => c.json({ error: "API route not found" }, 404));
  app.get("/", async (c) => c.html(await readFile(resolveWithin(publicRoot, "index.html"), "utf8")));
  return app;
}
