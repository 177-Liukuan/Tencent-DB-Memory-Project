import { randomUUID } from "node:crypto";
import { readFile, mkdir, appendFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { drainPreparedMemory } from "./prepare-memory.js";
import { inspectMemorySeed, type SeedEndpoint } from "./memory-seed.js";
import { secureWriteJson } from "../lib/fs.js";
import { preparationFetch } from "./preparation-llm.js";
import { memoryCacheKey, memoryPreparationVersion, prepareMemoryWithCache } from "./memory-cache.js";
import type { MemoryMessage } from "../importers/memories/importer.js";

export type MemoryBuildInput = {
  project:string;directory:string;maxTokens:number;
  thinking?:"default"|"disabled";
  cacheDirectory?:string;
  identity:SeedEndpoint["identity"];
  sessions:Array<{session_id:string;messages:MemoryMessage[]}>;
};

// 在单独进程和目录中复用原 Core 的提炼函数，不启动 Gateway 或调度队列。
// 因而不会影响正在评测的 Agent，也不需要给生产 Core 增加“立即提炼”接口。
export async function buildPreparedMemory(input: MemoryBuildInput) {
  if (![4096,8192].includes(input.maxTokens)) throw new Error("准备阶段输出上限只支持 4096 或 8192");
  await mkdir(input.directory,{recursive:true,mode:0o700});
  const load = (file:string) => import(pathToFileURL(join(input.project,"MemoryCore/src",file)).href);
  // 这是与两个独立仓库的动态加载边界；调用的都是原 Core 公开工厂，不复制提炼算法。
  const [{loadGatewayConfig},{createStoreBundle},factories,{StandaloneLLMRunnerFactory}] = await Promise.all([
    load("gateway/config.ts"),load("core/store/factory.ts"),load("utils/pipeline-factory.ts"),load("adapters/standalone/llm-runner.ts"),
  ]);
  const gateway = loadGatewayConfig();
  const cfg = gateway.memory;
  if (cfg.embedding.provider !== "none") throw new Error("当前一键评测固定使用原 Standalone BM25 配置，两组不得混用检索方式");
  const llmConfig = {...gateway.llm,maxTokens:input.maxTokens};
  const originalFetch=globalThis.fetch;
  if (input.thinking==="disabled") globalThis.fetch=preparationFetch(originalFetch,llmConfig.baseUrl,llmConfig.model);
  cfg.llm = {...cfg.llm,...llmConfig,enabled:true};
  const logFile=join(input.directory,"extraction.log");
  let logWrites=Promise.resolve();
  let outputLimitEvents=0;
  const log=(level:string) => (message:string) => {
    if (message.includes("finishReason=length")) outputLimitEvents++;
    logWrites=logWrites.then(()=>appendFile(logFile,new Date().toISOString()+" "+level+" "+message+"\n",{mode:0o600}));
  };
  const logger = {info:log("INFO"),warn:log("WARN"),error:log("ERROR"),debug:log("DEBUG")};
  factories.initDataDirectories(input.directory);
  const bundle=createStoreBundle(cfg,{dataDir:input.directory,logger});
  bundle.store.init();
  const runnerFactory=new StandaloneLLMRunnerFactory({config:llmConfig,logger});
  const common={pluginDataDir:input.directory,cfg,openclawConfig:undefined,vectorStore:bundle.store,logger};
  const l1=factories.createL1Runner({...common,embeddingService:bundle.embedding,llmRunner:runnerFactory.createRunner({enableTools:false})});
  const l2=factories.createL2Runner({...common,llmRunner:runnerFactory.createRunner({enableTools:true})});
  const l3=factories.createL3Runner({...common,llmRunner:runnerFactory.createRunner({enableTools:true})});
  const start=Date.now();
  try {
    if (bundle.store.isDegraded()) throw new Error("准备目录的 Memory Store 不可用");
    const endpoint:SeedEndpoint={dbPath:join(input.directory,"vectors.db"),profilesRoot:join(input.directory,"profiles"),
      identity:input.identity,project:input.project};
    const expectedMessages=input.sessions.reduce((n,s)=>n+s.messages.length,0);
    const key=memoryCacheKey(input.sessions,{memory:cfg,thinking:input.thinking??"default"},
      input.cacheDirectory?await memoryPreparationVersion(input.project):"disabled");
    const prepared=await prepareMemoryWithCache({directory:input.cacheDirectory,key,target:endpoint,
      sessionIds:input.sessions.map(s=>s.session_id),expectedMessages},async()=>{
      let messageNumber=0;
      for (const session of input.sessions) for (const message of session.messages) {
        // recordedAt 严格递增，防止 Core 的时间游标略过同毫秒导入的后续消息。
        const ok=bundle.store.upsertL0({id:randomUUID(),sessionKey:session.session_id,sessionId:session.session_id,
          teamId:input.identity.team_id,userId:input.identity.user_id,agentId:input.identity.agent_id,
          role:message.role,messageText:message.content,recordedAt:new Date(start+messageNumber++).toISOString(),
          timestamp:message.timestamp?Date.parse(message.timestamp):start},undefined);
        if (!ok) throw new Error("L0 导入失败");
      }
      const stages=await drainPreparedMemory(input.sessions.map(s=>s.session_id),{
        l1:session=>l1({sessionKey:session}),l2,l3,
      },messageNumber);
      const seed=await inspectMemorySeed(endpoint);
      if (messageNumber && (!seed.counts.l1_records || !seed.profileFiles.some(p=>p.startsWith("scene_blocks/")) || !seed.profileFiles.includes("persona.md"))) {
        throw new Error("L1/L2/L3 文件不完整，停止分发: "+JSON.stringify(seed));
      }
      const result={endpoint,seed,...stages,elapsed_ms:Date.now()-start,max_tokens:input.maxTokens,thinking:input.thinking??"default",retrieval:"bm25",output_limit_events:outputLimitEvents};
      await secureWriteJson(join(input.directory,"generation.json"),result);
      // Core 会容错处理部分截断输出；评测准备不能仅凭“文件存在”就把这些数据当完整输入。
      if (outputLimitEvents) throw new Error(`提炼发生 ${outputLimitEvents} 次输出截断，请检查 generation.json 和输出预算；不分发半成品`);
      return result;
    });
    // 命中时 timings 为空：本次只复制，不能把旧提炼耗时误记为本次 LLM 调用。
    const result={endpoint,seed:await inspectMemorySeed(endpoint),...prepared.preparation,
      elapsed_ms:Date.now()-start,...(prepared.cache?{cache:prepared.cache}:{})};
    await secureWriteJson(join(input.directory,"generation.json"),result);
    await secureWriteJson(join(input.directory,"ready.json"),result);
    return result;
  } finally {globalThis.fetch=originalFetch;bundle.store.close();await logWrites;}
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if (!process.argv[2]) throw new Error("需要准备输入文件路径");
  const input=JSON.parse(await readFile(process.argv[2],"utf8")) as MemoryBuildInput;
  await buildPreparedMemory(input);
}
