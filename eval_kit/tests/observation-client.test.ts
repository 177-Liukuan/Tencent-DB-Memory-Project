import { mkdtemp, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { runClaudeClient } from "../runner/client.js";
it("正式评测启用 Native Hooks，隔离设置，不使用会禁用 Hooks 的 bare", async () => {
  const d = await mkdtemp(join(tmpdir(), "eval-cli-"));
  try {
    await mkdir(join(d, "settings"));
    const binary = join(d, "claude-test");
    await writeFile(binary, "#!" + process.execPath + "\nconst fs = require('node:fs'); console.log(JSON.stringify({type:'result',result:JSON.stringify({args:process.argv.slice(2),thinking:process.env.MAX_THINKING_TOKENS,settings:JSON.parse(fs.readFileSync(process.env.CLAUDE_CONFIG_DIR+'/settings.json','utf8'))})}));\n", { mode: 0o700 });
    await writeFile(join(d, "env"), "ANTHROPIC_MODEL=old-model\n");
    await writeFile(join(d, "key"), "test-key");
    const result = await runClaudeClient({
      binary, variant: "native", sessionId: "test-session", workDirectory: d, claudeConfigDirectory: join(d,"settings"),
      envFile: join(d,"env"), authKeyFile: join(d,"key"), baseUrl: "http://localhost:18096/claude-code/space",
      identity: {service_id:"space",team_id:"team",agent_id:"agent",task_id:"task"}, timeoutMs: 5000,
      streamPath: join(d,"stream.jsonl"), testCase: { schema_version:1,case_id:"c",suite:"smoke",query:"hi",should_call:false,expected_tools:[] },
      evaluation: { model: "test-model", allowBash: true },
    });
    const output = JSON.parse(String(result.events[0]!.result));
    expect(output.args).not.toContain("--bare");
    expect(output.args).toContain("test-model");
    expect(output.args[output.args.indexOf("--allowedTools") + 1]).toBe("Bash,Read,Write,Edit,Glob,Grep");
    expect(output.settings.hooks.UserPromptSubmit[0].hooks[0]).toMatchObject({type:"http",url:"http://localhost:18096/claude-code/space/hooks/claude-code/context"});
    expect(output.thinking).toBe("0");
    expect(output.settings.alwaysThinkingEnabled).toBe(false);
    expect(result.exitCode).toBe(0); expect(result.completedAt).toBeDefined();
  } finally { await rm(d, {recursive:true,force:true}); }
});

it("工具观测达到指定步骤后停止 CLI，但不伪造最终回答或端到端延迟",async () => {
  const d=await mkdtemp(join(tmpdir(),"eval-stop-"));
  try {
    await mkdir(join(d,"settings"));await writeFile(join(d,"env"),"");await writeFile(join(d,"key"),"k");
    const binary=join(d,"client"), observation=join(d,"observations.jsonl");
    await writeFile(binary,"#!"+process.execPath+"\nconst fs=require('node:fs');fs.writeFileSync("+JSON.stringify(observation)+",JSON.stringify({tool_name:'skill_view'})+'\\n');setTimeout(()=>fs.appendFileSync("+JSON.stringify(observation)+",JSON.stringify({tool_name:'skill_files_read'})+'\\n'),300);setInterval(()=>{},1000);\n",{mode:0o700});
    const result=await runClaudeClient({binary,variant:"baseline",sessionId:"s",workDirectory:d,claudeConfigDirectory:join(d,"settings"),
      envFile:join(d,"env"),authKeyFile:join(d,"key"),baseUrl:"http://localhost",identity:{service_id:"s",team_id:"t",agent_id:"a",task_id:"k"},
      timeoutMs:5000,streamPath:join(d,"stream.jsonl"),testCase:{schema_version:1,case_id:"c",suite:"smoke",query:"q",should_call:true,expected_tools:["skill_view"]},
      evaluation:{model:"m"},observationStop:{file:observation,tools:["skill_view","skill_files_read"]}});
    expect(result.stoppedOnObservation).toBe(true);expect(result.timedOut).toBe(false);expect(result.completedAt).toBeUndefined();
    expect(Date.parse(result.endedAt)-Date.parse(result.startedAt)).toBeLessThan(3000);
  } finally {await rm(d,{recursive:true,force:true});}
});
