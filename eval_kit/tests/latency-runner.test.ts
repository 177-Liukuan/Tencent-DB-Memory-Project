import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runObservationExperiment, scoreObservationExperiment } from "../bridge-eval/runner.js";
import type { PreparedRun } from "../bridge-eval/config.js";
import type { EvalCase } from "../types.js";

it("超时后两组整题排除，跳过剩余重复并准备同类替补；正常说明无法继续也计时", async () => {
  const d = await mkdtemp(join(tmpdir(), "latency-runner-"));
  try {
    const health = { enabled: true, healthy: true, started_at: "2026-09-07T00:00:00.000Z" };
    for (const v of ["baseline", "native"]) { await mkdir(join(d,v)); await writeFile(join(d,v,"observer.json"),JSON.stringify(health)); }
    await mkdir(join(d,"seed")); await writeFile(join(d,"seed","code.txt"),"initial");
    const c = (id: string): EvalCase => ({schema_version:1,case_id:id,suite:"main",query:"任务",tool_family:"memory",should_call:true,expected_tools:["tdai_memory_search"]});
    const rows = (id: string): PreparedRun[] => [1,2].flatMap(repeat => (["baseline","native"] as const).map(variant => ({
      run_id:`${id}-${variant}-${repeat}`,case_id:id,variant,repeat,seed_version:"frozen",workspace:join(d,"seed"),
      identity:{service_id:"s",team_id:"t",agent_id:`${id}-${repeat}`,task_id:`${id}-${repeat}`},
    })));
    await writeFile(join(d,"cases.jsonl"),JSON.stringify(c("old"))+"\n");
    await writeFile(join(d,"manifest.json"),JSON.stringify(rows("old")));
    await writeFile(join(d,"config.json"),JSON.stringify({version:2,experiment_id:"latency-test",dataset:"cases.jsonl",run_manifest:"manifest.json",results_dir:"results",claude_binary:"unused",model:"model",
      measurement:"end_to_end",latency_repeats:2,timeout_ms:600000,client_image:"test-image",
      variants:Object.fromEntries(["baseline","native"].map(v=>[v,{proxy_base_url:`http://${v}/`,observation_dir:v,env_file:"env",auth_key_file:"key"}]))}));
    const executed: string[] = [];
    const result = await runObservationExperiment(join(d,"config.json"),{
      fetcher: async () => new Response(JSON.stringify({toolObservation:health})),
      prepareReplacement: async failed => { expect(failed.case_id).toBe("old"); return {testCase:c("new"),runs:rows("new")}; },
      runClient: async input => {
        expect(input.observationStop).toBeUndefined();
        expect(input.evaluation?.skipPermissions).toBe(true);
        expect(await readFile(join(input.workDirectory,"code.txt"),"utf8")).toBe("initial");
        await writeFile(join(input.workDirectory,"code.txt"),"changed");
        executed.push(input.testCase.case_id+"-"+input.variant);
        const timeout = input.testCase.case_id === "old" && input.variant === "native";
        return {events:timeout?[]:[{type:"result",is_error:false,result:"环境不支持，无法继续。"}],exitCode:timeout?null:0,timedOut:timeout,
          startedAt:health.started_at,endedAt:"2026-09-07T00:10:00.000Z",completedAt:"2026-09-07T00:00:02.000Z",ttftMs:0,stderr:""};
      },
    });
    expect(executed).toEqual(["old-baseline","old-native","new-baseline","new-native","new-baseline","new-native"]);
    expect(result.runs).toHaveLength(8);
    expect(result.summary.baseline.total_runs).toBe(0);
    expect(result.summary.latency_study).toMatchObject({included_tasks:1,excluded_tasks:1,baseline:{count:2,mean:2000},native:{count:2,mean:2000}});
    expect(result.runs.filter(r=>r.case_id==="old").every(r=>r.latency_excluded_reason)).toBe(true);
    expect(await scoreObservationExperiment(result.experimentDirectory)).toEqual(result.summary);
    expect(await readFile(join(d,"seed","code.txt"),"utf8")).toBe("initial");
  } finally { await rm(d,{recursive:true,force:true}); }
});
