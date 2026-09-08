// 浏览器联调只写临时目录，不把人工数据混入正式实验结果。
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { createViewerApp } from "../viewer/server.js";

const root = await mkdtemp(join(tmpdir(), "latency-viewer-browser-"));
const exp = join(root, "latency-fixture");
await mkdir(join(exp, "runs"), {recursive:true});
const save = (file:string, value:unknown) => writeFile(join(exp,file),JSON.stringify(value));
await save("config.json", {version:2,experiment_id:"latency-fixture",model:"fixture-no-llm",measurement:"end_to_end"});
const manifest = [];
for (const task of ["task-ok", "task-excluded"]) for (const repeat of [1,2]) for (const variant of ["baseline","native"] as const) {
  const prepared = {run_id:`${task}-${variant}-${repeat}`,case_id:task,variant,repeat,seed_version:"frozen",
    workspace:"/fixture",identity:{service_id:"svc",team_id:variant,agent_id:`${task}-${repeat}`,task_id:`${task}-${repeat}`}};
  manifest.push(prepared);
  await save(`runs/${prepared.run_id}.json`,{...prepared,session_id:prepared.run_id,suite:"main",tool_family:"memory",
    query:"读取项目的历史约定。",should_call:true,expected_tools:["tdai_memory_search"],actual_tools:["tdai_memory_search"],
    observation_valid:true,completed:true,end_to_end_ms:repeat*2000+(variant==="native"?-1000:0),
    measurement:"end_to_end",latency_repeats:2,final_answer:"已经返回最终响应。",
    ...(task==="task-excluded"?{latency_excluded_reason:"同题一次运行超时，仅保留诊断记录"}:{})});
}
await save("manifest.json",manifest);
const server = serve({fetch:createViewerApp({resultsRoot:root}).fetch,hostname:"127.0.0.1",port:0},info=>{
  process.stdout.write(`http://127.0.0.1:${info.port}/?view=results&experiment=latency-fixture\n`);
});
process.once("SIGTERM",()=>server.close(()=>{ void rm(root,{recursive:true,force:true}).then(()=>process.exit(0)); }));
