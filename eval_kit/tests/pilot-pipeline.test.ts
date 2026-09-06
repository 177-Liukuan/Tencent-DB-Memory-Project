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
    await writeFile(file, JSON.stringify({...config,reuse_preparation:"frozen/pilot"}));
    expect((await loadPilotConfig(file)).reuse_preparation).toBe(join(d,"frozen/pilot"));
    await writeFile(file, JSON.stringify({...config,team_member_user_ids:["usr-f7iwo2muhb"]}));
    expect((await loadPilotConfig(file)).team_member_user_ids).toEqual(["usr-f7iwo2muhb"]);
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
    await mkdir(profile, {recursive:true}); await writeFile(join(profile, "persona.md"), "画像内容 r1");
    const original = await inspectMemorySeed(source);
    const copied = await copyMemorySeed(source, target);
    expect(copied.digest).toBe(original.digest);
    expect(copied.counts).toMatchObject({l0_conversations:1,l1_records:1,l0_fts:1,l1_fts:1});
    const db = new DatabaseSync(target.dbPath, {readOnly:true});
    expect({...db.prepare("SELECT * FROM l1_records").get()}).toEqual({record_id:"r1",team_id:"t2",user_id:"u2",agent_id:"a2",content:"保留正文"}); db.close();
    expect(await readFile(join(target.profilesRoot, encodeURIComponent("team:t2|agent:a2"), "persona.md"), "utf8")).toBe("画像内容 r1");
    await expect(copyMemorySeed(source, target)).rejects.toThrow("非空");
    const additional = new DatabaseSync(source.dbPath);
    for (const t of ["l0_conversations","l1_records","l0_fts","l1_fts"]) {
      additional.exec(`INSERT INTO ${t} VALUES('r3','t1','u1','a1','第二条记忆')`);
    }
    additional.close();
    // 同一 Core 留着上一轮数据时，新 Agent 必须能复制相同事实而不撞全局主键。
    const next = {...target,identity:{team_id:"t3",agent_id:"a3",user_id:"u3"}};
    const replay = await copyMemorySeed(source,next,"replay-1");
    expect(replay.counts.l1_records).toBe(2);
    const check = new DatabaseSync(target.dbPath,{readOnly:true});
    const copiedRecord = check.prepare("SELECT record_id,content FROM l1_records WHERE agent_id='a3' AND content='保留正文'").get()!;
    expect(copiedRecord.record_id).not.toBe("r1");
    expect(copiedRecord.content).toBe("保留正文");
    expect(await readFile(join(next.profilesRoot,encodeURIComponent("team:t3|agent:a3"),"persona.md"),"utf8"))
      .toBe("画像内容 "+copiedRecord.record_id);
    expect(check.prepare("SELECT record_id FROM l1_fts WHERE agent_id='a3' AND content='保留正文'").get()!.record_id).toBe(copiedRecord.record_id);
    expect(check.prepare("SELECT count(*) AS n FROM l1_records WHERE agent_id='a2'").get()!.n).toBe(1);
    check.close();
  } finally { await rm(root, {recursive:true,force:true}); }
});
