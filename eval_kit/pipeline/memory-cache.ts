import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { backup, DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { secureWriteJson } from "../lib/fs.js";
import type { MemoryMessage } from "../importers/memories/importer.js";
import { copyMemorySeed, inspectMemorySeed, type SeedEndpoint } from "./memory-seed.js";

const preparationSchema = z.object({
  processedMessages:z.number().int().nonnegative(),
  timings:z.array(z.object({stage:z.string(),elapsed_ms:z.number().nonnegative()})),
  scheduled_wait_ms:z.number().nonnegative(),elapsed_ms:z.number().nonnegative(),
  max_tokens:z.number().int().positive(),thinking:z.string(),retrieval:z.string(),
  output_limit_events:z.number().int().nonnegative(),
});
type Preparation = z.infer<typeof preparationSchema>;
const manifestSchema = z.object({
  version:z.literal(1),key:z.string().regex(/^[a-f0-9]{64}$/),
  identity:z.object({team_id:z.string(),agent_id:z.string(),user_id:z.string()}),
  sessionIds:z.array(z.string().min(1)),seedDigest:z.string(),preparation:preparationSchema,
});
type CacheOptions = {
  directory?:string|undefined;key:string;target:SeedEndpoint;sessionIds:string[];expectedMessages:number;
};

function canonical(value:unknown):unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value)
    // 密钥轮换不改变提炼含义，也不应影响复用；缓存只记录最终校验值，不落完整配置。
    .filter(([key,v])=>v!==undefined && !/^(apiKey|secretKey|secretId|password|token|authorization)$/i.test(key))
    .sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>[key,canonical(v)]));
  return value;
}

export function memoryCacheKey(sessions:Array<{session_id:string;messages:MemoryMessage[]}>,settings:unknown,sourceVersion:string):string {
  // 忽略运行时新建的会话编号；保留会话分组、消息先后、正文和原始时间。
  return createHash("sha256").update(JSON.stringify(canonical({version:1,
    sessions:sessions.map(s=>s.messages),settings,sourceVersion}))).digest("hex");
}

export async function memoryPreparationVersion(project:string):Promise<string> {
  const hash=createHash("sha256");
  const add=async(path:string,label:string)=>{hash.update(label+"\0").update(await readFile(path)).update("\0");};
  const walk=async(root:string,prefix:string):Promise<void>=>{
    for (const entry of (await readdir(root,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error("Memory 提炼源码不允许符号链接: "+join(root,entry.name));
      if (entry.isDirectory()) await walk(join(root,entry.name),prefix+"/"+entry.name);
      else await add(join(root,entry.name),prefix+"/"+entry.name);
    }
  };
  // 用实际源码和依赖版本，而非整个仓库 commit；修改 Proxy 提示词不应重跑 Memory。
  await walk(join(project,"MemoryCore/src"),"src");
  await add(join(project,"MemoryCore/package.json"),"package.json");
  // 当前 Core 未提交锁文件，npm 安装信息在 node_modules 中；有哪份就记录哪份。
  for (const file of ["package-lock.json","pnpm-lock.yaml","yarn.lock","node_modules/.package-lock.json","node_modules/.pnpm/lock.yaml"]) {
    const path=join(project,"MemoryCore",file);
    const info=await stat(path).catch(error=>{
      if ((error as NodeJS.ErrnoException).code==="ENOENT") return null;
      throw error;
    });
    if (info) await add(path,file);
  }
  for (const file of ["memory-builder.ts","prepare-memory.ts","preparation-llm.ts","memory-cache.ts","memory-seed.ts"]) {
    await add(fileURLToPath(new URL(file,import.meta.url)),"pipeline/"+file);
  }
  return hash.update(process.version).digest("hex");
}

async function checkedSeed(target:SeedEndpoint,expectedMessages:number) {
  const seed=await inspectMemorySeed(target);
  if (seed.counts.l0_conversations!==expectedMessages || (expectedMessages &&
    (!seed.counts.l1_records || !seed.profileFiles.includes("persona.md") || !seed.profileFiles.some(p=>p.startsWith("scene_blocks/"))))) {
    throw new Error("Memory L0/L1/L2/L3 不完整，不复用或发布缓存");
  }
  return seed;
}

// 缓存只持有准备底稿，不引用正式 Agent；每次命中仍复制为当前任务的独立数据。
export async function prepareMemoryWithCache(options:CacheOptions,build:()=>Promise<Preparation>):Promise<{
  preparation:Preparation;cache?:{key:string;status:"hit"|"miss";source_elapsed_ms?:number};
}> {
  const {directory,key,target,sessionIds,expectedMessages}=options;
  if (!/^[a-f0-9]{64}$/.test(key) || sessionIds.some(id=>!id) || new Set(sessionIds).size!==sessionIds.length) {
    throw new Error("Memory 缓存标识或会话编号无效");
  }
  const entry=directory?join(directory,key):undefined;
  const exists=entry?await stat(entry).catch(error=>{
    if ((error as NodeJS.ErrnoException).code==="ENOENT") return null;
    throw error;
  }):null;
  if (entry && exists) {
    const start=Date.now();
    // 缺文件或损坏不是正常未命中，必须明确报错，不能悄悄换一份随机提炼结果。
    try {
      const manifest=manifestSchema.parse(JSON.parse(await readFile(join(entry,"manifest.json"),"utf8")));
      if (manifest.key!==key || manifest.sessionIds.length!==sessionIds.length ||
        new Set(manifest.sessionIds).size!==manifest.sessionIds.length || manifest.preparation.output_limit_events ||
        manifest.preparation.processedMessages!==expectedMessages) throw new Error("准备记录不匹配");
      const source:SeedEndpoint={...target,dbPath:join(entry,"vectors.db"),profilesRoot:join(entry,"profiles"),identity:manifest.identity};
      if ((await checkedSeed(source,expectedMessages)).digest!==manifest.seedDigest) throw new Error("底稿内容已改变");
      const sessionMap=new Map(manifest.sessionIds.map((id,i)=>[id,sessionIds[i]!]));
      await copyMemorySeed(source,target,"cache:"+key+":"+JSON.stringify(target.identity),sessionMap);
      return {preparation:{...manifest.preparation,timings:[],elapsed_ms:Date.now()-start},
        cache:{key,status:"hit",source_elapsed_ms:manifest.preparation.elapsed_ms}};
    } catch (error) { throw new Error(`Memory 缓存不可用 ${entry}: ${error instanceof Error?error.message:String(error)}`); }
  }

  const preparation=preparationSchema.parse(await build());
  if (preparation.output_limit_events) throw new Error("Memory 提炼发生截断，不发布缓存");
  if (preparation.processedMessages!==expectedMessages) throw new Error("Memory 消息处理不完整");
  const seed=await checkedSeed(target,expectedMessages);
  if (!entry || !directory) return {preparation};
  await mkdir(directory,{recursive:true,mode:0o700});
  const temporary=await mkdtemp(join(directory,".building-"));
  try {
    // SQLite backup 包含 WAL 中的数据；目录全部写完后才发布，避免中断留下可用的半成品。
    const db=new DatabaseSync(target.dbPath,{readOnly:true});
    try { await backup(db,join(temporary,"vectors.db")); } finally { db.close(); }
    if (seed.profileFiles.length) await cp(target.profilesRoot,join(temporary,"profiles"),{recursive:true,errorOnExist:true,force:false});
    await secureWriteJson(join(temporary,"manifest.json"),{version:1,key,identity:target.identity,sessionIds,seedDigest:seed.digest,preparation});
    await rename(temporary,entry);
  } finally { await rm(temporary,{recursive:true,force:true}); }
  return {preparation,cache:{key,status:"miss"}};
}
