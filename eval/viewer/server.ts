import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { Hono } from "hono";

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

async function jsonLines(root: string, child: string): Promise<Record<string, unknown>[]> {
  return (await readFile(await resolveExistingWithin(root, child), "utf8")).split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

export function createViewerApp(options: { resultsRoot: string }): Hono {
  const app = new Hono();
  const publicRoot = resolve(dirname(fileURLToPath(import.meta.url)), "public");

  app.use("*", async (c, next) => {
    await next();
    c.header("content-security-policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    c.header("referrer-policy", "no-referrer");
    c.header("x-content-type-options", "nosniff");
  });
  app.onError((error, c) => c.json({ error: error.message }, 400));
  app.get("/api/experiments", async (c) => {
    const entries = await readdir(options.resultsRoot, { withFileTypes: true }).catch(() => []);
    const experiments: unknown[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      try {
        const summary = await jsonFile(options.resultsRoot, `${entry.name}/summary.json`) as Record<string, unknown>;
        experiments.push({ experiment_id: entry.name, ...summary });
      } catch { /* incomplete experiment */ }
    }
    return c.json(experiments);
  });
  app.get("/api/experiments/:experiment/summary", async (c) => {
    const experiment = c.req.param("experiment");
    return c.json(await jsonFile(options.resultsRoot, `${experiment}/summary.json`));
  });
  app.get("/api/experiments/:experiment/cases", async (c) => {
    const experiment = c.req.param("experiment");
    let items = await jsonLines(options.resultsRoot, `${experiment}/cases.jsonl`);
    const variant = c.req.query("variant");
    const status = c.req.query("status");
    const family = c.req.query("family");
    const failure = c.req.query("failure");
    const failedOnly = c.req.query("failed") === "true";
    if (variant) items = items.filter((item) => item.variant === variant);
    if (status) items = items.filter((item) => item.status === status);
    if (family) items = items.filter((item) => item.tool_family === family);
    if (failure) items = items.filter((item) => Array.isArray(item.failure_tags) && item.failure_tags.includes(failure));
    if (failedOnly) items = items.filter((item) => !(item.metrics as Record<string, unknown> | undefined)?.case_pass);
    return c.json({ items, total: items.length });
  });
  app.get("/api/experiments/:experiment/runs/:run", async (c) => {
    const experiment = c.req.param("experiment");
    const run = c.req.param("run");
    if (!/^[A-Za-z0-9._-]+$/u.test(experiment) || !/^[A-Za-z0-9._-]+$/u.test(run)) return c.json({ error: "Invalid identifier" }, 400);
    return c.json(await jsonFile(options.resultsRoot, `${experiment}/runs/${run}.json`));
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
  app.get("*", async (c) => c.html(await readFile(resolveWithin(publicRoot, "index.html"), "utf8")));
  return app;
}
