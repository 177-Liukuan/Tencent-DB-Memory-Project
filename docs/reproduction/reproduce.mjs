import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import { pathToFileURL } from 'node:url';

if(!process.env.REPRO_ROOT) throw Error('Set REPRO_ROOT to the independent deployment directory');
const root=path.resolve(process.env.REPRO_ROOT);
const project=path.join(root,'Tencent-DB-Memory-Project');
const yaml=(await import(pathToFileURL(path.join(project,'eval_kit/node_modules/js-yaml/dist/js-yaml.mjs')).href)).default;
const lab=path.join(root,'lab');
const action=process.argv[2];
const key=()=>crypto.randomBytes(32).toString('hex');
const write=(p,s)=>{fs.mkdirSync(path.dirname(p),{recursive:true,mode:0o700});fs.writeFileSync(p,s,{mode:0o600,flag:'wx'});};
const envfile=p=>Object.fromEntries(fs.readFileSync(p,'utf8').split('\n').filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const n=l.indexOf('=');return[l.slice(0,n),l.slice(n+1).replace(/^['"]|['"]$/g,'')];}));
const dump=o=>Object.entries(o).map(([k,v])=>`${k}=${JSON.stringify(String(v))}`).join('\n')+'\n';
const variants=['baseline','native'];
const source=v=>path.join(project,`TencentDB-Agent-Memory-${v==='native'?'Native':'Baseline'}`);
const ports=v=>({core:v==='baseline'?28420:38420,proxy:v==='baseline'?28096:38096});
if(action==='credentials'){
  if(!process.env.DEEPSEEK_API_KEY)throw Error('DEEPSEEK_API_KEY is required');
  const network=Object.fromEntries(['HTTP_PROXY','HTTPS_PROXY','NO_PROXY','NODE_USE_ENV_PROXY'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  write(path.join(root,'credentials.json'),JSON.stringify({coreUrl:process.env.DEEPSEEK_BASE_URL??'https://api.deepseek.com',coreKey:process.env.DEEPSEEK_API_KEY,coreModel:process.env.DEEPSEEK_MODEL??'deepseek-v4-flash',proxyUrl:process.env.DEEPSEEK_ANTHROPIC_URL??'https://api.deepseek.com/anthropic/v1/messages',proxyKey:process.env.DEEPSEEK_API_KEY,model:process.env.CLAUDE_MODEL??'deepseek-v4-flash[1m]',clickhousePassword:key(),claude:execFileSync('which',['claude'],{encoding:'utf8'}).trim(),uv:execFileSync('which',['uv'],{encoding:'utf8'}).trim(),network}));
  console.log('Private credentials saved; values not displayed');
}else if(action==='configure'){
  const credentials=JSON.parse(fs.readFileSync(path.join(root,'credentials.json'),'utf8'));
  for(const v of variants){
    const dir=path.join(lab,v), p=ports(v), gateway=key();
    const core=yaml.load(fs.readFileSync(path.join(source(v),'MemoryCore/tdai-gateway.standalone.yaml'),'utf8'));
    core.instanceId='reproduce99';core.server={host:'127.0.0.1',port:p.core};core.data={baseDir:path.join(dir,'data/core')};
    core.llm={provider:'openai',baseUrl:credentials.coreUrl,model:credentials.coreModel,maxTokens:8192,timeoutMs:120000};
    core.skill={enabled:true,routing:{mode:'bm25',searchTopK:20},extraction:{enabled:true,maxIterations:16},resources:{maxResourceSizeBytes:5000000,allowExecutable:false}};
    core.observability={langfuse:{enabled:false},otel:{enabled:false}};
    write(path.join(dir,'config/core.yaml'),yaml.dump(core));write(path.join(dir,'secrets/core-gateway.key'),gateway+'\n');
    write(path.join(dir,'secrets/core.env'),dump({...credentials.network,TDAI_GATEWAY_CONFIG:path.join(dir,'config/core.yaml'),TDAI_GATEWAY_HOST:'127.0.0.1',TDAI_GATEWAY_PORT:p.core,TDAI_DATA_DIR:core.data.baseDir,TDAI_INSTANCE_ID:'reproduce99',TDAI_GATEWAY_API_KEY:gateway,TDAI_LLM_API_KEY:credentials.coreKey,TDAI_LLM_BASE_URL:credentials.coreUrl,TDAI_LLM_MODEL:credentials.coreModel,TDAI_SKILL_ENABLED:'true',LANGFUSE_ENABLED:'false'}));
    const proxy={server:{host:'127.0.0.1',port:p.proxy,forwardTimeoutMs:600000},upstream:{url:credentials.proxyUrl,apiKey:credentials.proxyKey,agents:{'claude-code':{protocol:'native'}}},log:{backend:'console',level:'info',verbose:false},redis:{enabled:false},storage:{enabled:true,backend:'sqlite',sqlite:{dbPath:path.join(dir,'data/proxy/proxy.db')}},langfuse:{enabled:false},clickhouse:{enabled:v==='native',url:'http://127.0.0.1:28123',database:'reproduce99',user:'reproduce99',password:credentials.clickhousePassword},auth:{enabled:true,url:`http://127.0.0.1:${p.core}`,timeoutMs:5000},admin:{apiKey:key()},sessionInit:{enabled:true,maxRetries:3,injectAgentContext:true,injectTaskContext:true,headerAutoSelect:{enabled:true,teamHeader:'x-team-id',agentHeader:'x-agent-id',taskHeader:'x-task-id',onMismatch:'form'}},tdai:{enabled:true,endpoint:`http://127.0.0.1:${p.core}`,apiKey:gateway,serviceId:'reproduce99',memory:{enabled:true,inject:true,writeL0:true,recallL1:true,injectL2L3:true,l1Limit:5,l2Limit:3,timeoutMs:5000}},skill:{endpoint:`http://127.0.0.1:${p.core}`,serviceToken:gateway,serviceId:'reproduce99',timeoutMs:5000},knowledge:{enabled:false},injection:{enabled:true,injectors:['skill','tdai-memory']},extraction:{enabled:true,extractors:['skill','tdai-memory']},skillRuntime:{allowLlmWrite:false},memCommand:{enabled:false},evalToolObservation:{enabled:true,directory:path.join(dir,'run/tool-observations')}};
    if(v==='native')proxy.nativeProxyTools={enabled:true,maxRounds:0,maxCallsPerRound:0,maxTotalCalls:0,toolTimeoutMs:20000,maxResultBytes:65536,stateTtlSeconds:1800,stateStorage:{backend:'clickhouse',table:'native_proxy_tool_execution_state'}};
    write(path.join(dir,'secrets/proxy.yaml'),yaml.dump(proxy));
    write(path.join(dir,'secrets/claude.env'),dump({ANTHROPIC_BASE_URL:`http://127.0.0.1:${p.proxy}/claude-code/reproduce99`,ANTHROPIC_MODEL:credentials.model,ANTHROPIC_DEFAULT_HAIKU_MODEL:credentials.model,ANTHROPIC_DEFAULT_SONNET_MODEL:credentials.model,ANTHROPIC_DEFAULT_OPUS_MODEL:credentials.model}));
    fs.mkdirSync(path.join(dir,'data/core'),{recursive:true});fs.mkdirSync(path.join(dir,'data/proxy'),{recursive:true});
  }
  write(path.join(root,'clickhouse.env'),dump({CLICKHOUSE_DB:'reproduce99',CLICKHOUSE_USER:'reproduce99',CLICKHOUSE_PASSWORD:credentials.clickhousePassword,CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT:1}).replace(/="([^"]*)"/g,'=$1'));
  const cfg=yaml.load(fs.readFileSync(path.join(project,'eval_kit/configs/standalone.example.yaml'),'utf8'));
  Object.assign(cfg,{lab_root:lab,service_id:'reproduce99',claude_binary:fs.realpathSync(credentials.claude),uv_binary:fs.realpathSync(credentials.uv),model:credentials.model,client_image:'tdai-test99-cli:node22-py312',per_family:1,sample_seed:'test99-reproduction',start_services:false,restart_proxies:false,team_member_user_ids:[]});
  for(const v of variants)cfg.variants[v]={project:source(v),core_url:`http://127.0.0.1:${ports(v).core}`,proxy_url:`http://127.0.0.1:${ports(v).proxy}/claude-code/reproduce99`};
  write(path.join(project,'eval_kit/configs/reproduce.local.yaml'),yaml.dump(cfg));
  console.log('Created private configuration and empty data directories');
}else if(action==='start'){
  const v=process.argv[3],component=process.argv[4];if(!variants.includes(v)||!['core','proxy'].includes(component))throw Error('Invalid service');
  const dir=path.join(lab,v);
  if(component==='core'){
    Object.assign(process.env,envfile(path.join(dir,'secrets/core.env')));
    process.env.LOG_PATH=path.join(dir,'logs/core');
    process.argv=[process.argv[0],path.join(source(v),'MemoryCore/src/gateway/server.ts')];
    process.chdir(path.join(source(v),'MemoryCore'));
    await import(path.join(source(v),'MemoryCore/src/gateway/server.ts'));
  }else{
    const gateway=fs.readFileSync(path.join(dir,'secrets/core-gateway.key'),'utf8').trim();const forward=globalThis.fetch;
    globalThis.fetch=(input,init={})=>{const url=new URL(typeof input==='string'||input instanceof URL?String(input):input.url);if(url.origin===`http://127.0.0.1:${ports(v).core}`&&url.pathname==='/v3/meta/auth/verify'){const headers=new Headers(init.headers??(input instanceof Request?input.headers:undefined));headers.set('authorization',`Bearer ${gateway}`);init={...init,headers};}return forward(input,init);};
    process.argv=[process.argv[0],path.join(source(v),'MemoryProxy/src/index.ts'),'--config',path.join(dir,'secrets/proxy.yaml')];
    process.chdir(path.join(source(v),'MemoryProxy'));await import(process.argv[1]);
  }
}else if(action==='identity'){
  for(const v of variants){
    const secret=path.join(lab,v,'secrets'),gateway=fs.readFileSync(path.join(secret,'core-gateway.key'),'utf8').trim();
    async function call(route,body,userKey){const r=await fetch(`http://127.0.0.1:${ports(v).core}${route}`,{method:'POST',headers:{'content-type':'application/json','x-tdai-service-id':'reproduce99',authorization:`Bearer ${gateway}`,...(userKey?{'x-tdai-user-key':userKey}:{})},body:JSON.stringify(body)});const j=await r.json();if(!r.ok||j.code!==0)throw Error(`${v} ${route}: ${r.status} ${j.code} ${j.message}`);return j.data;}
    const admin=await call('/v3/internal/meta/user/init-admin',{username:'reproduce-admin'});
    write(path.join(secret,'admin-user.key'),admin.user_key+'\n');
    const user=await call('/v3/meta/user/create',{username:'rhino-researcher',user_id:'usr-f7iwo2muhb'},admin.user_key);
    write(path.join(secret,'memory-user.key'),user.default_user_key+'\n');console.log(v,'created',user.user_id);
  }
}else throw Error('Expected credentials, configure, start or identity');
