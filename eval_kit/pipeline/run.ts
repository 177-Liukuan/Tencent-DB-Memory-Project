import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve, relative } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { loadPilotConfig, selectPilotCases, type PilotConfig } from "./config.js";
import { copyMemorySeed, inspectMemorySeed, type SeedEndpoint } from "./memory-seed.js";
import { isolateSeedSessions } from "./inputs.js";
import { waitForHttp } from "./readiness.js";
import { prepareClientImage } from "./container-image.js";
import { captureStaticTokenCheck } from "./static-tokens.js";
import { auditPilotResults } from "./audit.js";
import { snapshotWorkspace } from "./workspace.js";
import { parseEnvFile } from "../runner/config.js";
import { loadDataset } from "../runner/dataset-loader.js";
import { discoverSkillPackages, importSkillDirectory, type SkillPackage, type SkillImportTarget } from "../importers/skills/importer.js";
import { discoverMemorySessions } from "../importers/memories/importer.js";
import { secureWriteJson, secureWriteJsonl, secureWrite } from "../lib/fs.js";
import { runObservationExperiment } from "../bridge-eval/runner.js";
import type { PreparedRun } from "../bridge-eval/config.js";
import type { Variant } from "../types.js";

const exec = promisify(execFile);
const variants: Variant[] = ["baseline", "native"];
type Connection = { variant:Variant; userKey:string; gatewayKey:string; userId:string; baseUrl:string; serviceId:string };
async function api<T>(connection: Connection, path: string, body: unknown): Promise<T> {
  const response = await fetch(connection.baseUrl + path, {
    method:"POST", headers:{"content-type":"application/json","x-tdai-service-id":connection.serviceId,
      "x-tdai-user-key":connection.userKey,authorization:"Bearer " + connection.gatewayKey},
    body:JSON.stringify(body), signal:AbortSignal.timeout(60_000),
  });
  const result = await response.json() as { code:number;message?:string;data:T };
  if (!response.ok || result.code !== 0) throw new Error(`${connection.variant} ${path}: ${result.code ?? response.status} ${result.message ?? ""}`);
  return result.data;
}
async function revision(project: string) {
  const head = (await exec("git", ["-C",project,"rev-parse","HEAD"])).stdout.trim();
  const diff = (await exec("git", ["-C",project,"diff","HEAD","--binary"], {maxBuffer:20*1024*1024})).stdout;
  return {head,tracked_diff_sha256:createHash("sha256").update(diff).digest("hex")};
}
function endpoint(config: PilotConfig, connection: Connection, run: PreparedRun): SeedEndpoint {
  const root = join(config.lab_root,connection.variant,"data/core");
  return {dbPath:join(root,"instances",config.service_id,"vectors.db"),profilesRoot:join(root,"profiles"),
    project:config.variants[connection.variant].project,
    identity:{team_id:run.identity.team_id,agent_id:run.identity.agent_id,user_id:connection.userId}};
}
function importTarget(connection: Connection, run: PreparedRun): SkillImportTarget {
  return {label:run.run_id,baseUrl:connection.baseUrl,apiKey:connection.gatewayKey,serviceId:connection.serviceId,
    userId:connection.userId,teamId:run.identity.team_id,agentId:run.identity.agent_id};
}
async function verifySkills(connection: Connection, run: PreparedRun, packages: SkillPackage[]) {
  const identity = {user_id:connection.userId,team_id:run.identity.team_id,agent_id:run.identity.agent_id};
  const verified: Array<{name:string;content:string;resources:unknown[]}> = [];
  for (const skill of packages) {
    const stored = await api<{skill_id:string;content:string}>(connection,"/v3/skill/get-by-name",{...identity,skill_name:skill.name});
    if (!stored.content) throw new Error("导入后 Skill 正文为空: " + skill.name);
    const resources: unknown[] = [];
    for (const resource of skill.resources) {
      const file = await api<{content:string;encoding:string}>(connection,"/v3/skill/files/read",{
        ...identity,skill_id:stored.skill_id,path:resource.path,encoding:resource.encoding,
      });
      if (file.content !== resource.content) throw new Error("Skill 资源导入前后不一致: " + skill.name + "/" + resource.path);
      resources.push(resource);
    }
    verified.push({name:skill.name,content:stored.content,resources});
  }
  return createHash("sha256").update(JSON.stringify(verified)).digest("hex");
}

export async function runPilotPipeline(configPath: string) {
  const config = await loadPilotConfig(configPath);
  const dataset = await loadDataset(config.dataset);
  const selected = selectPilotCases(dataset.cases, config.per_family);
  const skills = await discoverSkillPackages(config.skills);
  const sessions = await discoverMemorySessions(config.memories);
  // 所有引用先检查，不能创建一半 Agent 后才发现素材路径或 Skill 名拼错。
  for (const c of selected) {
    if (!c.asset_path || !(await stat(resolve(config.asset_base,c.asset_path))).isDirectory()) throw new Error("缺少项目素材: " + c.case_id);
    for (const name of c.candidate_skills ?? []) if (!skills.some(s=>s.name === name)) throw new Error("缺少 Skill: " + name);
    for (const id of c.source_memory_sessions ?? []) if (!sessions.some(s=>s.sessionId === id)) throw new Error("缺少 Memory: " + id);
  }
  if (config.start_services) await exec("systemctl", ["--user","start", ...variants.flatMap(v=>["core","proxy"].map(s=>`tdam-${v}-${s}.service`))]);
  const connections = {} as Record<Variant,Connection>;
  const revisions = {} as Record<Variant,Awaited<ReturnType<typeof revision>>>;
  for (const variant of variants) {
    const coreConfig=yaml.load(await readFile(join(config.lab_root,variant,"config/core.yaml"),"utf8")) as {memory:{embedding:{provider:string};bm25?:{enabled:boolean}}};
    if (coreConfig.memory.embedding.provider!=="none" || coreConfig.memory.bm25?.enabled===false) {
      throw new Error(variant+" 当前一键评测固定为原 Standalone BM25 检索，请统一两组配置后运行");
    }
    await waitForHttp(config.variants[variant].core_url);
    await waitForHttp(new URL("/health",config.variants[variant].proxy_url).href);
    const secret = join(config.lab_root,variant,"secrets");
    const connection: Connection = {variant,baseUrl:config.variants[variant].core_url.replace(/\/$/,""),serviceId:config.service_id,userId:"",
      userKey:(await readFile(join(secret,"admin-user.key"),"utf8")).trim(),gatewayKey:(await readFile(join(secret,"core-gateway.key"),"utf8")).trim()};
    connection.userId = (await api<{user_id:string}>(connection,"/v3/meta/user/get",{user_key:connection.userKey})).user_id;
    const health = await fetch(new URL("/health",config.variants[variant].proxy_url),{signal:AbortSignal.timeout(10_000)});
    const h = await health.json() as {toolObservation?:{enabled:boolean;healthy:boolean;started_at:string}};
    if (!health.ok || !h.toolObservation?.enabled || !h.toolObservation.healthy) throw new Error(variant + " 观测未启用或不健康");
    const marker = JSON.parse(await readFile(join(config.lab_root,variant,"run/tool-observations/observer.json"),"utf8"));
    if (marker.started_at !== h.toolObservation.started_at) throw new Error(variant + " 观测目录不匹配");
    connections[variant] = connection; revisions[variant] = await revision(config.variants[variant].project);
  }
  const id = "pilot-" + new Date().toISOString().replace(/[:.]/g,"-");
  const preparation = join(config.results_dir,"preparation",id);
  await mkdir(preparation,{recursive:true,mode:0o700});
  await secureWriteJson(join(preparation,"pipeline-config.json"),config);
  await secureWriteJson(join(preparation,"revisions-before.json"),revisions);
  await secureWriteJsonl(join(preparation,"cases.jsonl"),selected);
  const runConnections = new Map<string,Connection>();
  const runs: PreparedRun[] = [];
  const imports: unknown[] = [];
  const pairChecks: unknown[] = [];
  const workspaces = new Map<string,Awaited<ReturnType<typeof snapshotWorkspace>>>();
  process.stderr.write(`[pipeline] ${id}: ${selected.length} Tasks / ${selected.length*2} runs\n`);
  try {
    await secureWriteJson(join(preparation,"client-environment.json"),await prepareClientImage(config.client_image,config.uv_binary,config.claude_binary));
    for (const [index,c] of selected.entries()) {
      const label = "task-" + String(index+1).padStart(2,"0");
      const input = join(preparation,"inputs",label);
      const taskSkills = skills.filter(s=>(c.candidate_skills ?? []).includes(s.name));
      const taskSessions = sessions.filter(s=>(c.source_memory_sessions ?? []).includes(s.sessionId));
      const workspace=await snapshotWorkspace(resolve(config.asset_base,c.asset_path!),join(input,"workspace"));
      workspaces.set(c.case_id,workspace);
      await secureWriteJson(join(input,"workspace-version.json"),workspace);
      await mkdir(join(input,"skills"),{recursive:true,mode:0o700});
      for (const skill of taskSkills) await cp(dirname(skill.filePath),join(input,"skills",skill.name),{recursive:true,errorOnExist:true,force:false});
      const isolatedSessions = isolateSeedSessions(taskSessions,id,label);
      await secureWriteJson(join(input,"memory-session-map.json"),isolatedSessions.map(({source_session_id,session_id})=>({source_session_id,session_id})));
      await secureWriteJson(join(input,"memories","sessions.json"),isolatedSessions.map(({session_id,messages})=>({session_id,messages})));
      for (const variant of variants) {
        // 每个 Task 单独建号，Session Init 只会列出自己的资源，不扫描其他评测任务。
        const user = await api<{user_id:string;default_user_key:string}>(connections[variant],"/v3/meta/user/create",{username:id+"-"+label});
        const connection = {...connections[variant],userKey:user.default_user_key,userId:user.user_id};
        const keyFile = join(preparation,"keys",label+"-"+variant+".key");
        await secureWrite(keyFile,connection.userKey);
        // 名称和描述不包含 Memory/Skill/None 标签，避免把答案通过 session_context 提示给模型。
        const team = await api<{team_id:string}>(connection,"/v3/meta/team/create",{name:id+"-"+label,owner_user_id:connection.userId,description:"独立项目工作区"});
        const agent = await api<{agent_id:string}>(connection,"/v3/meta/agent/create",{team_id:team.team_id,owner_user_id:connection.userId,name:"通用Coding Agent",description:"一个通用Coding Agent"});
        const task = await api<{task_id:string}>(connection,"/v3/meta/task/create",{team_id:team.team_id,creator_user_id:connection.userId,title:"项目维护",description:"完成当前用户请求",linked_agents:[{agent_id:agent.agent_id}]});
        const run: PreparedRun = {run_id:label+"-"+variant,case_id:c.case_id,variant,repeat:1,seed_version:"pending",
          auth_key_file:keyFile,
          ...(config.stop_after_tools[c.case_id] ? {stop_after_tools:config.stop_after_tools[c.case_id]} : {}),
          workspace:workspace.directory,identity:{service_id:config.service_id,team_id:team.team_id,agent_id:agent.agent_id,task_id:task.task_id}};
        runConnections.set(run.run_id,connection);
        runs.push(run); await secureWriteJson(join(preparation,"manifest.pending.json"),runs);
        const target = importTarget(connection,run);
        const skillImport = taskSkills.length ? await importSkillDirectory({directory:join(input,"skills"),target,onConflict:"error",dryRun:false}) : null;
        imports.push({run_id:run.run_id,skillImport,memoryImport:"独立 Core 准备完成后复制"});
        await secureWriteJson(join(preparation,"imports.json"),imports);
        process.stderr.write(`[pipeline] imported ${run.run_id}\n`);
      }
    }
    for (const [index,c] of selected.entries()) {
      const baseline = runs.find(r=>r.case_id === c.case_id && r.variant === "baseline")!;
      const native = runs.find(r=>r.case_id === c.case_id && r.variant === "native")!;
      const label="task-"+String(index+1).padStart(2,"0");
      const directory=join(preparation,"builder",label);
      const inputFile=join(directory,"input.json");
      const builderSessions=JSON.parse(await readFile(join(preparation,"inputs",label,"memories/sessions.json"),"utf8"));
      const baselineTarget=endpoint(config,runConnections.get(baseline.run_id)!,baseline);
      await secureWriteJson(inputFile,{project:config.variants.baseline.project,directory,maxTokens:config.preparation_max_tokens,
        thinking:config.preparation_thinking,identity:baselineTarget.identity,sessions:builderSessions});
      const environment=parseEnvFile(await readFile(join(config.lab_root,"baseline/secrets/core.env"),"utf8"));
      process.stderr.write(`[pipeline] building ${label}: L1 → L2 → L3, maxTokens=${config.preparation_max_tokens}\n`);
      await exec(process.execPath,["--import","tsx",fileURLToPath(new URL("./memory-builder.ts",import.meta.url)),inputFile],{
        cwd:fileURLToPath(new URL("../",import.meta.url)),env:{...process.env,...environment},timeout:config.processing_timeout_ms,maxBuffer:2*1024*1024,
      });
      const source:SeedEndpoint={...baselineTarget,dbPath:join(directory,"vectors.db"),profilesRoot:join(directory,"profiles")};
      const target = endpoint(config,runConnections.get(native.run_id)!,native);
      const seed = await inspectMemorySeed(source);
      const expectedMessages = sessions.filter(s=>(c.source_memory_sessions ?? []).includes(s.sessionId)).reduce((n,s)=>n+s.messages.length,0);
      if (seed.counts.l0_conversations !== expectedMessages || (expectedMessages && (!seed.counts.l1_records || !seed.profileFiles.some(p=>p.startsWith("scene_blocks/")) || !seed.profileFiles.includes("persona.md")))) {
        throw new Error(c.case_id + " L0/L1/L2/L3 未准备完整: " + JSON.stringify(seed));
      }
      const baselineCopied = await copyMemorySeed(source,baselineTarget);
      const copied = await copyMemorySeed(source,target);
      const taskSkills = skills.filter(s=>(c.candidate_skills ?? []).includes(s.name));
      const skillDigests = await Promise.all([baseline,native].map(r=>verifySkills(runConnections.get(r.run_id)!,r,taskSkills)));
      if (skillDigests[0] !== skillDigests[1]) throw new Error(c.case_id + " 两组 Skill 内容不同");
      const apiChecks = [];
      for (const [v,r] of [["baseline",baseline],["native",native]] as const) {
        const connection = runConnections.get(r.run_id)!;
        const body = {user_id:connection.userId,team_id:r.identity.team_id,agent_id:r.identity.agent_id};
        const l0 = await api<{total:number}>(connection,"/v3/conversation/count",body);
        const l1 = await api<{total:number}>(connection,"/v3/atomic/count",body);
        if (l0.total !== expectedMessages || l1.total !== seed.counts.l1_records) throw new Error(c.case_id + " API 与本地种子数量不同");
        apiChecks.push({variant:v,l0:l0.total,l1:l1.total});
      }
      baseline.seed_version = native.seed_version = createHash("sha256").update(seed.digest + skillDigests[0] + workspaces.get(c.case_id)!.digest).digest("hex");
      pairChecks.push({case_id:c.case_id,seed_version:baseline.seed_version,source:seed,baseline:baselineCopied,target:copied,
        workspace_digest:workspaces.get(c.case_id)!.digest,skill_digest:skillDigests[0],apiChecks,retrieval:"bm25"});
      await secureWriteJson(join(preparation,"pair-checks.json"),pairChecks);
      process.stderr.write(`[pipeline] verified pair ${c.case_id}: L0=${seed.counts.l0_conversations}, L1=${seed.counts.l1_records}, profiles=${seed.profileFiles.length}\n`);
    }
    // 配对执行且交替谁先跑，避免始终让同一组承受冷启动或固定时段的负载。
    const ordered = selected.flatMap((c,index)=>(index%2 ? ["native","baseline"] : ["baseline","native"]).map(v=>runs.find(r=>r.case_id===c.case_id && r.variant===v)!));
    await secureWriteJson(join(preparation,"manifest.json"),ordered);
    const observationConfig = {
      version:2,experiment_id:id,dataset:join(preparation,"cases.jsonl"),run_manifest:join(preparation,"manifest.json"),results_dir:config.results_dir,
      claude_binary:config.claude_binary,model:config.model,timeout_ms:config.timeout_ms,allow_bash:config.allow_bash,client_image:config.client_image,
      measurement:config.measurement,
      variants:Object.fromEntries(variants.map(v=>[v,{proxy_base_url:config.variants[v].proxy_url,
        session_state_db:join(config.lab_root,v,"data/proxy/proxy.db"),
        observation_dir:join(config.lab_root,v,"run/tool-observations"),env_file:join(config.lab_root,v,"secrets/claude.env"),auth_key_file:join(config.lab_root,v,"secrets/memory-user.key")}]))};
    const runConfig = join(preparation,"observation-config.json");
    await secureWriteJson(runConfig,observationConfig);
    await secureWriteJson(join(preparation,"ready.json"),{at:new Date().toISOString(),config:runConfig});
    const result = await runObservationExperiment(runConfig);
    const audit = await auditPilotResults(result.experimentDirectory,config.lab_root);
    await secureWriteJson(join(result.experimentDirectory,"pipeline-audit.json"),audit);
    const staticTokens = await captureStaticTokenCheck(config.lab_root,result.runs).catch(error=>({status:"unavailable",reason:String(error)}));
    await secureWriteJson(join(result.experimentDirectory,"static-token-check.json"),staticTokens);
    await secureWriteJson(join(result.experimentDirectory,"data-preparation.json"),{directory:preparation,pairChecks});
    const after = Object.fromEntries(await Promise.all(variants.map(async v=>[v,await revision(config.variants[v].project)])));
    await secureWriteJson(join(result.experimentDirectory,"revisions-after.json"),after);
    const unchanged = JSON.stringify(after) === JSON.stringify(revisions);
    const lines = result.runs.map(r=>`| ${r.case_id} | ${r.variant} | ${r.observation_valid ? "有效" : "无效"} | ${r.completed ? "已返回最终回答" : r.stopped_on_observation ? "到观测点停止" : "未完成，查看错误记录"} | ${r.actual_tools.join(" → ") || "无"} | ${r.end_to_end_ms === null ? "—" : (r.end_to_end_ms/1000).toFixed(2)} |`);
    await secureWrite(join(result.experimentDirectory,"report.md"),`# ${selected.length} Task Pipeline 实际运行\n\n实验：${id}\n\n准备记录：${relative(result.experimentDirectory,preparation)}\n\n两组工具代码是否保持不变：${unchanged}\n\n模式：${config.measurement}。工具观测有效不等于 Coding 成功；CLI 返回最终回答也没有经过代码正确性验收。\n\n每次运行使用独立 Team、Agent、Session 和工作区。真实业务服务，不 Mock；tool_calls 模式在指定事件出现后停止客户端，end_to_end 模式等待最终回答。准备数据不计入延迟。统计只用于检查流程，不作为正式效果结论。\n\n| Task | 版本 | 工具观测 | CLI 状态 | 实际 Proxy 调用顺序 | 端到端秒 |\n|---|---|---|---|---|---|\n${lines.join("\n")}\n\n详细指标见 summary.json；原始 CLI 和 Bridge 事件见 raw/；初始数据核对见 data-preparation.json。\n`);
    process.stderr.write(`[pipeline] report: ${join(result.experimentDirectory,"report.md")}\n`);
    if (!unchanged) throw new Error("实验中项目代码发生变化，请核对 revisions-before/after");
    if (audit.issues.length) throw new Error("运行记录核对未通过，请检查 pipeline-audit.json");
    if (result.runs.some(r=>!r.observation_valid)) throw new Error("部分运行无效，结果已保存，不能当作无工具调用计分");
    if (config.measurement==="end_to_end" && result.runs.some(r=>!r.completed)) throw new Error("工具调用已记录，但部分任务未完成，不能当作端到端全部通过");
    return result;
  } catch (error) {
    await secureWriteJson(join(preparation,"failure.json"),{at:new Date().toISOString(),message:error instanceof Error ? error.message : String(error)});
    throw error;
  }
}
