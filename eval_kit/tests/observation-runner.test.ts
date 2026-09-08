import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runObservationExperiment, scoreObservationExperiment } from "../bridge-eval/runner.js";
import type { ClientRunInput } from "../runner/client.js";
it("无需 Langfuse：真实文件采集、独立身份、零调用和失败采集分别保存，禁止 Agent 再用", async () => {
  const d = await mkdtemp(join(tmpdir(), "bridge-runner-"));
  try {
    const health = { enabled: true, healthy: true, started_at: "2026-09-05T00:00:00.000Z" };
    for (const v of ["baseline","native"]) {
      await mkdir(join(d,v)); await writeFile(join(d,v,"observer.json"),JSON.stringify(health));
    }
    await mkdir(join(d,"seed"));
    await writeFile(join(d,"cases.jsonl"), [
      {schema_version:1,case_id:"p",suite:"main",query:"query",should_call:true,expected_tools:["tdai_memory_search"],tool_family:"memory"},
      {schema_version:1,case_id:"n",suite:"main",query:"hello",should_call:false,expected_tools:[],tool_family:"none"},
      {schema_version:1,case_id:"e",suite:"main",query:"error",should_call:false,expected_tools:[],tool_family:"none"},
    ].map(x=>JSON.stringify(x)).join("\n"));
    const rows = ["p","n"].flatMap(c=>["baseline","native"].map(v=>({
      run_id:c+"-"+v,case_id:c,variant:v,repeat:1,seed_version:"seed",workspace:"seed",
      auth_key_file:"keys/"+c+"-"+v+".key",
      identity:{service_id:"space",team_id:"team-"+c,agent_id:"agent-"+c,task_id:"task-"+c},
    })));
    rows.splice(3,0,{run_id:"e-baseline",case_id:"e",variant:"baseline",repeat:1,seed_version:"seed",workspace:"seed",auth_key_file:"keys/e-baseline.key",
      identity:{service_id:"space",team_id:"team-e",agent_id:"agent-e",task_id:"task-e"}});
    await writeFile(join(d,"manifest.json"),JSON.stringify(rows));
    const config = {version:2,experiment_id:"test",measurement:"tool_calls",dataset:"cases.jsonl",run_manifest:"manifest.json",results_dir:"results",claude_binary:"unused",model:"model",
      variants:Object.fromEntries(["baseline","native"].map(v=>[v,{proxy_base_url:"http://"+v+"/claude-code/space",observation_dir:v,env_file:"env",auth_key_file:"key"}]))};
    await writeFile(join(d,"config.json"),JSON.stringify(config));
    const identities: string[] = []; const sessions = new Set<string>(); let unhealthy = false;
    const runClient = async (input: ClientRunInput) => {
      expect(input.authKeyFile).toBe(join(d,"keys",input.testCase.case_id+"-"+input.variant+".key"));
      identities.push(input.variant+":"+input.identity.agent_id); sessions.add(input.sessionId);
      if (input.testCase.case_id === "p") await writeFile(join(d,input.variant,input.sessionId+".jsonl"),JSON.stringify({
        event_id:"event",session_id:input.sessionId,tool_name:"tdai_memory_search",tool_family:"memory",timestamp:health.started_at,call_id:input.variant==="native"?"call":null,
      })+"\n");
      if (input.testCase.case_id==="n" && input.variant==="native") unhealthy=true;
      return {events:[{type:"result",result:input.testCase.case_id === "e" || (input.variant==="native"&&input.testCase.case_id==="p") ? "API Error: diagnostic" : "done",is_error:input.testCase.case_id === "e" || (input.variant==="native"&&input.testCase.case_id==="p")}],exitCode:0,timedOut:false,startedAt:health.started_at,
        completedAt:"2026-09-05T00:00:00.100Z",endedAt:"2026-09-05T00:00:01.000Z",ttftMs:20,stderr:""};
    };
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({toolObservation:{...health,healthy:!unhealthy}}));
    const result = await runObservationExperiment(join(d,"config.json"),{runClient,fetcher});
    expect(identities).toEqual(["baseline:agent-p","native:agent-p","baseline:agent-n","baseline:agent-e","native:agent-n"]);
    expect(sessions.size).toBe(5);
    expect(result.runs.map(r=>[r.observation_valid,r.actual_tools])).toEqual([[true,["tdai_memory_search"]],[true,["tdai_memory_search"]],[true,[]],[false,[]],[false,[]]]);
    expect(result.runs[3]!.error).toContain("API Error: diagnostic");
    expect(result.runs[1]).toMatchObject({observation_valid:true,completed:false,end_to_end_ms:null});
    expect(result.runs[0]!.end_to_end_ms).toBeNull();
    expect(result.summary.paired_comparison).toMatchObject({ total_pairs: 3, included_pairs: 1, excluded_pairs: 2 });
    expect(result.summary.paired_comparison.baseline).toMatchObject({ positive_samples: 1, negative_samples: 0, effective_call_rate: 1 });
    expect(result.summary.baseline.negative_samples).toBe(1);
    expect(await scoreObservationExperiment(result.experimentDirectory)).toEqual(result.summary);
    config.experiment_id="repeat"; unhealthy=false; await writeFile(join(d,"config.json"),JSON.stringify(config));
    const repeated=await runObservationExperiment(join(d,"config.json"),{runClient,fetcher});
    expect(repeated.runs.every(r=>!r.observation_valid)).toBe(true);
    expect(identities).toHaveLength(5);
  } finally { await rm(d,{recursive:true,force:true}); }
});
