import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { loadPilotConfig, selectPilotCases } from "../pipeline/config.js";
import { copyMemorySeed, inspectMemorySeed } from "../pipeline/memory-seed.js";
import type { EvalCase } from "../types.js";

it("一键入口默认只观测工具，准备预算保留 4096 且拒绝 16384", async () => {
  const d = await mkdtemp(join(tmpdir(), "pilot-config-"));
  try {
    const config = { lab_root: "lab", dataset: "tasks", asset_base: "assets", skills: "skills", memories: "memories",
      results_dir: "results", service_id: "test", claude_binary: "claude", uv_binary: "uv", model: "model",
      variants: { baseline: { project: "baseline", core_url: "http://localhost:8420", proxy_url: "http://localhost:8096" },
        native: { project: "native", core_url: "http://localhost:18420", proxy_url: "http://localhost:18096" } } };
    const file = join(d, "config.json");
    await writeFile(file, JSON.stringify(config));
    expect(await loadPilotConfig(file)).toMatchObject({ measurement: "tool_calls", preparation_max_tokens: 4096, restart_proxies:false });
    await writeFile(file, JSON.stringify({...config,restart_proxies:true}));
    expect((await loadPilotConfig(file)).restart_proxies).toBe(true);
    await writeFile(file, JSON.stringify({ ...config, preparation_max_tokens: 16384 }));
    await expect(loadPilotConfig(file)).rejects.toThrow();
  } finally { await rm(d, { recursive: true, force: true }); }
});

it("选择与文件顺序无关，各类覆盖不同场景且拒绝数量不足", () => {
  const cases = ["none", "memory", "skill"].flatMap(family => ["b", "a", "c"].map(scenario => ({
    schema_version: 1, case_id: family + "_" + scenario, suite: "main", tool_family: family,
    should_call: family !== "none", query: "任务", expected_tools: [], asset_path: "assets/x", scenario_id: scenario,
  }))) as EvalCase[];
  expect(selectPilotCases(cases, 3).map(c => c.case_id)).toEqual([
    "memory_a", "memory_b", "memory_c", "skill_a", "skill_b", "skill_c", "none_a", "none_b", "none_c",
  ]);
  expect(() => selectPilotCases(cases, 4)).toThrow("不足");
});

it("抽样先覆盖场景，再从同场景选更多题；固定 seed 和 all 可复现", () => {
  const cases = ["memory", "skill", "none"].flatMap(family => ["a", "b", "c"].flatMap(scenario => [1,2,3].map(n => ({
    schema_version:1, case_id:`${family}_${scenario}_${n}`, suite:"main", tool_family:family,
    should_call:family!=="none", query:"task", expected_tools:[], asset_path:"assets/x", scenario_id:scenario,
  })))) as EvalCase[];
  const sample = selectPilotCases(cases, 5, "pilot-30-20260905");
  expect(sample).toHaveLength(15);
  expect(new Set(sample.slice(0,3).map(c => c.scenario_id)).size).toBe(3);
  expect(selectPilotCases([...cases].reverse(), 5, "pilot-30-20260905")).toEqual(sample);
  expect(selectPilotCases(cases, "all", "pilot-30-20260905")).toHaveLength(27);
});

it("只复制指定 Agent 的 L0/L1/索引/画像，目标非空时拒绝重用", async () => {
  const root = await mkdtemp(join(tmpdir(), "pilot-seed-"));
  const source = { dbPath: join(root, "source.db"), profilesRoot: join(root, "p1"), identity: {team_id:"t1",agent_id:"a1",user_id:"u1"} };
  const target = { dbPath: join(root, "target.db"), profilesRoot: join(root, "p2"), identity: {team_id:"t2",agent_id:"a2",user_id:"u2"} };
  try {
    for (const endpoint of [source, target]) {
      const db = new DatabaseSync(endpoint.dbPath);
      for (const t of ["l0_conversations", "l1_records", "l0_fts", "l1_fts"]) {
        db.exec(`CREATE TABLE ${t}(record_id TEXT PRIMARY KEY, team_id TEXT, user_id TEXT, agent_id TEXT, content TEXT)`);
        if (endpoint === source) db.exec(`INSERT INTO ${t} VALUES('r1','t1','u1','a1','保留正文'),('other','tx','ux','ax','不得复制')`);
      }
      db.close();
    }
    const profile = join(source.profilesRoot, encodeURIComponent("team:t1|agent:a1"));
    await mkdir(profile, {recursive:true}); await writeFile(join(profile, "persona.md"), "画像内容");
    const original = await inspectMemorySeed(source);
    const copied = await copyMemorySeed(source, target);
    expect(copied.digest).toBe(original.digest);
    expect(copied.counts).toMatchObject({l0_conversations:1,l1_records:1,l0_fts:1,l1_fts:1});
    const db = new DatabaseSync(target.dbPath, {readOnly:true});
    expect({...db.prepare("SELECT * FROM l1_records").get()}).toEqual({record_id:"r1",team_id:"t2",user_id:"u2",agent_id:"a2",content:"保留正文"}); db.close();
    expect(await readFile(join(target.profilesRoot, encodeURIComponent("team:t2|agent:a2"), "persona.md"), "utf8")).toBe("画像内容");
    await expect(copyMemorySeed(source, target)).rejects.toThrow("非空");
  } finally { await rm(root, {recursive:true,force:true}); }
});
