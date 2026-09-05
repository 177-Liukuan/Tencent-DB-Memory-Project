import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { verifySessionInitialization } from "../bridge-eval/session-initialization.js";

it("没有成功关联预定 Agent 的会话不能作为零调用样本", async () => {
  const dir = await mkdtemp(join(tmpdir(),"eval-session-"));
  const path = join(dir,"proxy.db"); const db = new DatabaseSync(path);
  const identity = {service_id:"space",team_id:"team",agent_id:"agent",task_id:"task"};
  try {
    db.exec("CREATE TABLE proxy_kv (k TEXT PRIMARY KEY, v BLOB)");
    expect(()=>verifySessionInitialization(path,"session",identity)).toThrow("Session Init");
    const write = (state:unknown) => db.prepare("INSERT OR REPLACE INTO proxy_kv VALUES (?,?)").run("ttl/space/user/claude-code/session/inj-sess.json",Buffer.from(JSON.stringify(state)));
    write({status:"initialized",bypassed:true});
    expect(()=>verifySessionInitialization(path,"session",identity)).toThrow("Session Init");
    const sessionInfo = {space_id:"space",session_id:"session",user_id:"user",team_id:"team",agent_id:"wrong",task_id:"task",user_key:"never-expose"};
    write({status:"initialized",sessionInfo});
    expect(()=>verifySessionInitialization(path,"session",identity)).toThrow("Agent/Task");
    sessionInfo.agent_id="agent"; write({status:"initialized",sessionInfo});
    expect(verifySessionInitialization(path,"session",identity)).toEqual({initialized:true,user_id:"user",team_id:"team",agent_id:"agent",task_id:"task"});
  } finally {db.close(); await rm(dir,{recursive:true,force:true});}
});
