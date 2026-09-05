import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { readManifest, readOverview, readRun, viewerConfigSchema } from "./results.js";

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

export function createViewerApp(options: { resultsRoot: string }): Hono {
  const app = new Hono();
  const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "public");

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
  app.get("/api/experiments/:experiment/overview", async (c) => {
    const experiment = c.req.param("experiment");
    const current = await config(experiment);
    return c.json({ experiment_id: experiment, model: current.model, ...await readOverview(reader(experiment), c.req.query("suite")) });
  });
  app.get("/api/experiments/:experiment/runs/:run", async (c) => {
    const experiment = c.req.param("experiment");
    const run = c.req.param("run");
    identifier(run);
    await config(experiment);
    const read = reader(experiment);
    const row = (await readManifest(read)).find(r => r.run_id === run);
    if (!row) return c.json({ error: "该运行不在实验清单中。" }, 404);
    return c.json(await readRun(read, row));
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
