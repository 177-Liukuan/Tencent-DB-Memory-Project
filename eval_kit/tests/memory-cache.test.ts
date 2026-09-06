import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { memoryCacheKey, memoryPreparationVersion, prepareMemoryWithCache } from "../pipeline/memory-cache.js";
import { copyMemorySeed, type SeedEndpoint } from "../pipeline/memory-seed.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive:true,force:true}); });
async function temporary() { const root=await mkdtemp(join(tmpdir(),"eval-memory-cache-")); roots.push(root); return root; }
const messages = [{role:"user" as const,content:"接口统一返回 data",timestamp:"2026-01-01T00:00:00.000Z"}];
const settings = {llm:{model:"model-a",maxTokens:4096,apiKey:"never-save-this-secret"},thinking:"disabled"};
const key = () => memoryCacheKey([{session_id:"first-session",messages}],settings,"source-v1");
const preparation = {processedMessages:1,timings:[{stage:"L1",elapsed_ms:1000}],scheduled_wait_ms:0,
  elapsed_ms:2000,max_tokens:4096,thinking:"disabled",retrieval:"bm25",output_limit_events:0};

async function endpoint(root: string, agent: string): Promise<SeedEndpoint> {
  const result={dbPath:join(root,agent+".db"),profilesRoot:join(root,agent+"-profiles"),
    identity:{team_id:"team",user_id:"user",agent_id:agent}};
  const db=new DatabaseSync(result.dbPath);
  for (const table of ["l0_conversations","l1_records","l0_fts","l1_fts"]) {
    db.exec(`CREATE TABLE ${table}(record_id TEXT PRIMARY KEY, team_id TEXT, user_id TEXT, agent_id TEXT,
      session_key TEXT, session_id TEXT, content TEXT)`);
  }
  db.close(); return result;
}
async function generate(target:SeedEndpoint, session:string) {
  const db=new DatabaseSync(target.dbPath);
  for (const table of ["l0_conversations","l1_records","l0_fts","l1_fts"]) {
    db.prepare(`INSERT INTO ${table} VALUES (?,?,?,?,?,?,?)`)
      .run("record-1",target.identity.team_id,target.identity.user_id,target.identity.agent_id,session,session,"接口统一返回 data");
  }
  db.close();
  const profile=join(target.profilesRoot,encodeURIComponent(`team:team|agent:${target.identity.agent_id}`));
  await mkdir(join(profile,"scene_blocks"),{recursive:true});
  await writeFile(join(profile,"persona.md"),"项目约定");
  await writeFile(join(profile,"scene_blocks/api.md"),`引用 record-1，来源 ${session}`);
  return {...preparation};
}

it("同一 L0 的内容和提炼配置决定复用，不受新会话编号或配置字段顺序影响", () => {
  const again=memoryCacheKey([{messages,session_id:"next-experiment-session"}],
    {thinking:"disabled",llm:{apiKey:"rotated-secret",maxTokens:4096,model:"model-a"}},"source-v1");
  expect(again).toBe(key());
  expect(memoryCacheKey([{session_id:"x",messages:[{...messages[0]!,content:"接口返回 result"}]}],settings,"source-v1")).not.toBe(key());
  expect(memoryCacheKey([{session_id:"x",messages:[{...messages[0]!,timestamp:"2026-02-01T00:00:00.000Z"}]}],settings,"source-v1")).not.toBe(key());
  for (const change of [{llm:{model:"model-b",maxTokens:4096}}, {llm:{model:"model-a",maxTokens:8192}}, {thinking:"default"}]) {
    expect(memoryCacheKey([{session_id:"x",messages}],{...settings,...change},"source-v1")).not.toBe(key());
  }
  expect(memoryCacheKey([{session_id:"x",messages}],settings,"source-v2")).not.toBe(key());
  const next={role:"assistant" as const,content:"已记录"};
  expect(memoryCacheKey([{session_id:"x",messages:[...messages,next]}],settings,"v1"))
    .not.toBe(memoryCacheKey([{session_id:"x",messages:[next,...messages]}],settings,"v1"));
  expect(memoryCacheKey([{session_id:"x",messages:[...messages,next]}],settings,"v1"))
    .not.toBe(memoryCacheKey([{session_id:"x",messages},{session_id:"y",messages:[next]}],settings,"v1"));
});

it("提炼源码或提示词改变会失效，项目路径不同但内容相同不影响复用", async () => {
  const root=await temporary();
  for (const name of ["a","b"]) {
    await mkdir(join(root,name,"MemoryCore/src/prompts"),{recursive:true});
    await writeFile(join(root,name,"MemoryCore/package.json"),"{}");
    await writeFile(join(root,name,"MemoryCore/package-lock.json"),"{}");
    await writeFile(join(root,name,"MemoryCore/src/prompts/l1.md"),"提炼偏好");
  }
  const original=await memoryPreparationVersion(join(root,"a"));
  expect(await memoryPreparationVersion(join(root,"b"))).toBe(original);
  await writeFile(join(root,"b/MemoryCore/src/prompts/l1.md"),"提炼项目约定");
  expect(await memoryPreparationVersion(join(root,"b"))).not.toBe(original);
});

it("Core 没有项目锁文件时仍能运行，并识别安装目录中的依赖版本变化", async () => {
  const root=await temporary();
  await mkdir(join(root,"MemoryCore/src"),{recursive:true});
  await mkdir(join(root,"MemoryCore/node_modules"),{recursive:true});
  await writeFile(join(root,"MemoryCore/package.json"),"{}");
  await writeFile(join(root,"MemoryCore/node_modules/.package-lock.json"),'{"version":"1"}');
  const before=await memoryPreparationVersion(root);
  await writeFile(join(root,"MemoryCore/node_modules/.package-lock.json"),'{"version":"2"}');
  expect(await memoryPreparationVersion(root)).not.toBe(before);
});

it("跨任务复用只生成一次；复制会改写记录和会话编号，不污染底稿或其他 Agent", async () => {
  const root=await temporary(), directory=join(root,"cache");
  const first=await endpoint(root,"first"), second=await endpoint(root,"second");
  let calls=0;
  const a=await prepareMemoryWithCache({directory,key:key(),target:first,sessionIds:["session-one"],expectedMessages:1},async()=>{
    calls++; return generate(first,"session-one");
  });
  expect(a.cache?.status).toBe("miss");
  const b=await prepareMemoryWithCache({directory,key:key(),target:second,sessionIds:["session-two"],expectedMessages:1},async()=>{
    calls++; throw new Error("命中缓存时不应调用 LLM");
  });
  expect(calls).toBe(1);
  expect(b.cache).toMatchObject({status:"hit",source_elapsed_ms:2000});
  expect(b.preparation.timings).toEqual([]);
  const db=new DatabaseSync(second.dbPath);
  const row=db.prepare("SELECT * FROM l1_records").get()!;
  expect(row).toMatchObject({agent_id:"second",session_key:"session-two",session_id:"session-two",content:"接口统一返回 data"});
  expect(row.record_id).not.toBe("record-1");
  expect(db.prepare("SELECT record_id FROM l1_fts").get()!.record_id).toBe(row.record_id);
  const scene=await readFile(join(second.profilesRoot,encodeURIComponent("team:team|agent:second"),"scene_blocks/api.md"),"utf8");
  expect(scene).toBe(`引用 ${row.record_id}，来源 session-two`);
  // 正式 Agent 只得到副本，后续修改不能改变缓存中的初始事实。
  db.exec("UPDATE l1_records SET content='运行后新增的约定'"); db.close();
  const third=await endpoint(root,"third");
  await prepareMemoryWithCache({directory,key:key(),target:third,sessionIds:["session-three"],expectedMessages:1},async()=>{throw new Error("不应重新提炼");});
  const check=new DatabaseSync(third.dbPath,{readOnly:true});
  expect(check.prepare("SELECT content FROM l1_records").get()!.content).toBe("接口统一返回 data"); check.close();
  const baseline=await endpoint(root,"baseline"), native=await endpoint(root,"native");
  expect((await copyMemorySeed(third,baseline)).digest).toBe((await copyMemorySeed(third,native)).digest);
  expect(await readFile(join(directory,key(),"manifest.json"),"utf8")).not.toContain("never-save-this-secret");
});

it("内容或配置变化重新生成，显式关闭缓存也始终生成", async () => {
  const root=await temporary(), directory=join(root,"cache");let calls=0;
  for (const [index,cacheDirectory,cacheKey] of [[0,directory,key()],[1,directory,"b".repeat(64)],[2,undefined,key()],[3,undefined,key()]] as const) {
    const target=await endpoint(root,"agent-"+index);
    const result=await prepareMemoryWithCache({directory:cacheDirectory,key:cacheKey,target,sessionIds:["s"],expectedMessages:1},async()=>{calls++;return generate(target,"s");});
    expect(result.cache?.status).toBe(cacheDirectory?"miss":undefined);
  }
  expect(calls).toBe(4);
});

it("提炼失败、截断或缺少 L2/L3 不发布缓存；损坏的缓存明确报错", async () => {
  const root=await temporary(), directory=join(root,"cache");
  const target=await endpoint(root,"failed");
  const options={directory,key:key(),target,sessionIds:["s"],expectedMessages:1};
  await expect(prepareMemoryWithCache(options,async()=>{throw new Error("LLM 超时");})).rejects.toThrow("LLM 超时");
  expect(await readdir(directory).catch(()=>[])).toEqual([]);
  await expect(prepareMemoryWithCache(options,async()=>({...preparation,output_limit_events:1}))).rejects.toThrow("截断");
  await expect(prepareMemoryWithCache(options,async()=>({...preparation}))).rejects.toThrow("不完整");
  expect(await readdir(directory).catch(()=>[])).toEqual([]);
  await prepareMemoryWithCache(options,()=>generate(target,"s"));
  await writeFile(join(directory,key(),"manifest.json"),"broken JSON");
  const next=await endpoint(root,"next");
  await expect(prepareMemoryWithCache({...options,target:next},async()=>{throw new Error("不能吞掉缓存损坏并调用 LLM");})).rejects.toThrow("缓存");
});

it("没有初始 Memory 的任务可复用空底稿，不会凭空生成记忆", async () => {
  const root=await temporary(), directory=join(root,"cache");
  const cacheKey=memoryCacheKey([],settings,"v1");
  const first=await endpoint(root,"empty-first"), second=await endpoint(root,"empty-second");
  await prepareMemoryWithCache({directory,key:cacheKey,target:first,sessionIds:[],expectedMessages:0},async()=>({
    ...preparation,processedMessages:0,timings:[],elapsed_ms:0,
  }));
  const result=await prepareMemoryWithCache({directory,key:cacheKey,target:second,sessionIds:[],expectedMessages:0},async()=>{throw new Error("不应生成 Memory");});
  expect(result.cache?.status).toBe("hit");
  const db=new DatabaseSync(second.dbPath,{readOnly:true});
  expect(db.prepare("SELECT count(*) AS n FROM l1_records").get()!.n).toBe(0);db.close();
});

it("底稿被篡改时不复制，目标 Agent 保持为空", async () => {
  const root=await temporary(), directory=join(root,"cache");
  const first=await endpoint(root,"original"), second=await endpoint(root,"target");
  const options={directory,key:key(),sessionIds:["session"],expectedMessages:1};
  await prepareMemoryWithCache({...options,target:first},()=>generate(first,"session"));
  const modified=new DatabaseSync(join(directory,key(),"vectors.db"));
  modified.exec("UPDATE l1_records SET content='不是初始数据'"); modified.close();
  await expect(prepareMemoryWithCache({...options,target:second},async()=>{throw new Error("不能调用 LLM 掩盖损坏");})).rejects.toThrow("底稿内容已改变");
  const db=new DatabaseSync(second.dbPath,{readOnly:true});
  expect(db.prepare("SELECT count(*) AS n FROM l0_conversations").get()!.n).toBe(0);db.close();
});
