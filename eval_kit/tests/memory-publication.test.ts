import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { inspectMemorySeed, type SeedEndpoint } from "../pipeline/memory-seed.js";
import { publishMemorySeed } from "../pipeline/memory-publication.js";
import type { Connection } from "../pipeline/identity.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const tables = ["l0_conversations", "l1_records", "l0_fts", "l1_fts"];

async function fixture(empty = false) {
  const root = await mkdtemp(join(tmpdir(), "memory-publication-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const source: SeedEndpoint = { dbPath: join(root, "source.db"), profilesRoot: join(root, "source-profiles"),
    identity: { team_id: "source-team", user_id: "user", agent_id: "source-agent" } };
  const target: SeedEndpoint = { dbPath: join(root, "target.db"), profilesRoot: join(root, "target-profiles"),
    identity: { team_id: "team", user_id: "user", agent_id: "baseline-agent" } };
  for (const endpoint of [source, target]) {
    const db = new DatabaseSync(endpoint.dbPath);
    for (const table of tables) {
      const cols = "record_id,team_id,user_id,agent_id,task_id,session_id,content";
      db.exec(table.endsWith("_fts") ? `CREATE VIRTUAL TABLE ${table} USING fts5(${cols})`
        : `CREATE TABLE ${table}(record_id TEXT PRIMARY KEY,team_id TEXT,user_id TEXT,agent_id TEXT,task_id TEXT,session_id TEXT,content TEXT)`);
      if (endpoint === source && !empty) for (const [id, session] of [["r1", "history-one"], ["r2", "history-two"]] as const) {
        db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?)`).run(id, "source-team", "user", "source-agent", "", session, "RS256");
      }
      if (endpoint === target) db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?)`)
        .run("untouched", "team", "user", "other-agent", "other-task", "other-session", "不应修改");
    }
    db.close();
  }
  const profile = join(source.profilesRoot, encodeURIComponent("team:source-team|agent:source-agent"));
  await mkdir(profile, { recursive: true });
  await writeFile(join(profile, "persona.md"), "保持画像正文与记录引用 r1");
  const db = new DatabaseSync(target.dbPath);
  cleanups.push(async () => db.close());
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  let fault: "none" | "empty" | "empty-l1" | "error" | "wrong-session" = "none";
  // 仅替代外部 Core HTTP 服务；数据复制、FTS5 更新、任务过滤和请求发送均执行真实逻辑。
  const server = createServer(async (req, res) => {
    let raw = ""; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); const path = req.url!;
    requests.push({ path, body });
    const table = path === "/v3/conversation/query" ? "l0_conversations" : "l1_records";
    if (!["/v3/conversation/query", "/v3/atomic/query"].includes(path)) {
      res.writeHead(404); res.end(JSON.stringify({ code: 404, message: "unexpected endpoint" })); return;
    }
    let rows = db.prepare(`SELECT * FROM ${table} WHERE team_id=? AND user_id=? AND agent_id=? AND task_id=?`)
      .all(body.team_id, body.user_id, body.agent_id, body.task_id ?? "");
    if (body.session_id) rows = rows.filter(row => row.session_id === body.session_id);
    if (fault === "empty" || fault === "empty-l1" && table === "l1_records" || fault === "wrong-session" && body.session_id) rows = [];
    const data = { total: rows.length, [table === "l0_conversations" ? "messages" : "items"]: rows.slice(0, body.limit) };
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(fault === "error" ? { code: 503, message: "storage unavailable" } : { code: 0, message: "ok", data }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  const connection: Connection = { variant: "baseline", baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    serviceId: "instance", userId: "user", userKey: "test-user-key", gatewayKey: "test-gateway-key" };
  return { source, target, db, requests, connection, setFault: (value: typeof fault) => { fault = value; } };
}

it("发布时为 L0/L1 和 FTS 补齐运行 Task，旧空 Task 底稿及其他 Agent 不变", async () => {
  const f = await fixture(); const original = await inspectMemorySeed(f.source);
  const first = await publishMemorySeed(f.source, f.target, f.connection, "baseline-task");
  const native = { ...f.target, identity: { ...f.target.identity, agent_id: "native-agent" } };
  const second = await publishMemorySeed(f.source, native, { ...f.connection, variant: "native" }, "native-task", "next-run");
  for (const [agent, task] of [["baseline-agent", "baseline-task"], ["native-agent", "native-task"]] as const) {
    for (const table of tables) {
      expect(f.db.prepare(`SELECT count(*) AS n FROM ${table} WHERE agent_id=? AND task_id=?`).get(agent, task)?.n).toBe(2);
      expect(f.db.prepare(`SELECT content,task_id FROM ${table} WHERE record_id='untouched'`).get())
        .toMatchObject({ content: "不应修改", task_id: "other-task" });
    }
    expect(f.db.prepare("SELECT count(*) AS n FROM l0_fts WHERE l0_fts MATCH 'RS256' AND agent_id=? AND task_id=?").get(agent, task)?.n).toBe(2);
  }
  expect(first.digest).toBe(original.digest);
  expect(first.apiCheck).toMatchObject({ task_id: "baseline-task", l0: 2, l1: 2,
    sessions: [{ session_id: "history-one", total: 1 }, { session_id: "history-two", total: 1 }] });
  expect(second.apiCheck).toMatchObject({ task_id: "native-task", l0: 2, l1: 2 });
  expect(await inspectMemorySeed(f.source)).toEqual(original);
  expect(await readFile(join(f.target.profilesRoot, encodeURIComponent("team:team|agent:baseline-agent"), "persona.md"), "utf8"))
    .toBe("保持画像正文与记录引用 r1");
  expect(f.requests.every(r => r.body.task_id && r.body.team_id === "team" && r.body.user_id === "user" && r.body.limit === 1)).toBe(true);
});

it("每个重复运行重新映射自己的 Task，并检查该次运行的真实查询条件", async () => {
  // 两项目各自有独立数据库，配对记录使用相同内部 ID；不同重复之间再换号。
  const groups = { baseline: await fixture(), native: await fixture() };
  for (const repeat of [1, 2, 3]) {
    const results = [];
    for (const variant of ["baseline", "native"] as const) {
      const f = groups[variant];
      const target = { ...f.target, identity: { ...f.target.identity, agent_id: `${variant}-${repeat}` } };
      results.push(await publishMemorySeed(f.source, target, { ...f.connection, variant }, `${variant}-task-${repeat}`, `repeat-${repeat}`));
    }
    expect(results[0]!.digest).toBe(results[1]!.digest);
    expect(results.map(r => r.apiCheck.l0)).toEqual([2, 2]);
  }
  expect(new Set(Object.values(groups).flatMap(f => f.requests.map(r => r.body.task_id))).size).toBe(6);
});

it.each(["empty", "empty-l1", "wrong-session", "error"] as const)("查询返回 %s 时中止准备，不能以本地数量正确宣告可用", async fault => {
  const f = await fixture(); f.setFault(fault);
  await expect(publishMemorySeed(f.source, f.target, f.connection, "task"))
    .rejects.toThrow(fault === "error" ? "storage unavailable" : "Memory");
});

it("某张表绑定失败时回滚整个归属更新，不留下记录与索引归属不一致的副本", async () => {
  const f = await fixture();
  f.db.exec("CREATE TRIGGER reject_task BEFORE UPDATE OF task_id ON l1_records BEGIN SELECT RAISE(ABORT, 'task update rejected'); END");
  await expect(publishMemorySeed(f.source, f.target, f.connection, "task")).rejects.toThrow("task update rejected");
  for (const table of tables) {
    expect(f.db.prepare(`SELECT DISTINCT task_id FROM ${table} WHERE agent_id='baseline-agent'`).all()).toEqual([{ task_id: "" }]);
  }
  expect(f.requests).toHaveLength(0);
});

it("拒绝缺少 Task 的发布，也不覆盖已有 Agent 数据", async () => {
  const f = await fixture();
  await expect(publishMemorySeed(f.source, f.target, f.connection, "")).rejects.toThrow("Task");
  expect(f.db.prepare("SELECT count(*) AS n FROM l0_conversations WHERE agent_id='baseline-agent'").get()?.n).toBe(0);
  await publishMemorySeed(f.source, f.target, f.connection, "task");
  await expect(publishMemorySeed(f.source, f.target, f.connection, "another-task")).rejects.toThrow("非空");
  expect(f.db.prepare("SELECT DISTINCT task_id FROM l0_conversations WHERE agent_id='baseline-agent'").all()).toEqual([{ task_id: "task" }]);
});

it("没有初始 Memory 时核对空查询，不凭空生成数据", async () => {
  const f = await fixture(true);
  const result = await publishMemorySeed(f.source, f.target, f.connection, "task");
  expect(result.apiCheck).toMatchObject({ l0: 0, l1: 0, sessions: [] });
  expect(f.requests.map(r => r.path)).toEqual(["/v3/conversation/query", "/v3/atomic/query"]);
});
