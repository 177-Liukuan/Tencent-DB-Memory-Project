import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it } from "vitest";
import { createEvaluationTeam, createEvaluationTask, type Connection } from "../pipeline/identity.js";
import { validateRunManifest } from "../bridge-eval/config.js";
import { auditPilotResults } from "../pipeline/audit.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });

it("每组只建一个团队，任务和 Agent 属于查看资产的账号且互不复用", async () => {
  const requests: Array<{path:string; body:Record<string,unknown>; userKey:unknown}> = [];
  let team = 0, agent = 0, task = 0;
  const server = createServer(async (req,res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({path:req.url!,body,userKey:req.headers["x-tdai-user-key"]});
    const data = req.url === "/v3/meta/team/create" ? {team_id:`team-${++team}`}
      : req.url === "/v3/meta/agent/create" ? {agent_id:`agent-${++agent}`}
      : req.url === "/v3/meta/task/create" ? {task_id:`task-${++task}`} : {};
    res.setHeader("content-type","application/json"); res.end(JSON.stringify({code:0,data}));
  });
  servers.push(server); server.listen(0,"127.0.0.1"); await once(server,"listening");
  const address = server.address() as {port:number};
  const connection: Connection = {variant:"native",baseUrl:`http://127.0.0.1:${address.port}`,
    serviceId:"test",userId:"researcher",userKey:"researcher-key",gatewayKey:"gateway"};
  const teamId = await createEvaluationTeam(connection,"experiment",["researcher","viewer","viewer"]);
  const identities = [];
  for (let index=1; index<=30; index++) identities.push(await createEvaluationTask(connection,teamId,index));
  expect(requests.filter(r=>r.path==="/v3/meta/team/create")).toHaveLength(1);
  expect(requests.filter(r=>r.path==="/v3/meta/team-member/add").map(r=>r.body.user_id)).toEqual(["viewer"]);
  expect(requests.some(r=>r.path==="/v3/meta/user/create")).toBe(false);
  const agents=requests.filter(r=>r.path==="/v3/meta/agent/create");
  expect(agents).toHaveLength(30);
  expect(agents[0]!.body).toMatchObject({team_id:"team-1",owner_user_id:"researcher",name:"agent_1",description:"处理通用开发任务与日常协作",visibility:"private"});
  expect(agents[29]!.body.name).toBe("agent_30");
  const tasks=requests.filter(r=>r.path==="/v3/meta/task/create");
  expect(tasks[0]!.body).toMatchObject({team_id:"team-1",creator_user_id:"researcher",title:"task_1",description:"完成用户请求",linked_agents:[{agent_id:"agent-1"}]});
  expect(tasks[29]!.body.title).toBe("task_30");
  expect(requests.every(r=>r.userKey==="researcher-key")).toBe(true);
  expect(new Set(identities.map(i=>i.agent_id)).size).toBe(30);
  expect(new Set(identities.map(i=>i.task_id)).size).toBe(30);
  expect(new Set(identities.map(i=>i.team_id))).toEqual(new Set(["team-1"]));
});

it("同组允许共享 Team，但禁止重复 Agent 或 Task", () => {
  const rows = [1,2].map(n=>({run_id:`run-${n}`,case_id:`case-${n}`,variant:"native",repeat:1,
    seed_version:"seed",workspace:"workspace",identity:{service_id:"test",team_id:"one-team",agent_id:`agent-${n}`,task_id:`task-${n}`}}));
  expect(validateRunManifest(rows)).toHaveLength(2);
  expect(()=>validateRunManifest([rows[0],{...rows[1],identity:{...rows[1]!.identity,agent_id:"agent-1"}}])).toThrow("Duplicate");
  expect(()=>validateRunManifest([rows[0],{...rows[1],identity:{...rows[1]!.identity,task_id:"task-1"}}])).toThrow("Duplicate");
});

it("审计允许同一用户运行不同 Agent，但仍拒绝重复 Agent、Task、Session", async () => {
  const root=await mkdtemp(join(tmpdir(),"shared-team-audit-"));
  const lab=join(root,"lab"); const proxy=join(lab,"native/data/proxy");
  await mkdir(proxy,{recursive:true}); await mkdir(join(root,"runs"));
  const db=new DatabaseSync(join(proxy,"proxy.db"));
  db.exec("CREATE TABLE proxy_kv (k TEXT PRIMARY KEY, v BLOB)");
  try {
    const rows=[1,2].map(n=>({run_id:`run-${n}`,case_id:`case-${n}`,variant:"native",repeat:1,
      seed_version:"seed",workspace:"workspace",identity:{service_id:"test",team_id:"one-team",agent_id:`agent-${n}`,task_id:`task-${n}`}}));
    await writeFile(join(root,"manifest.json"),JSON.stringify(rows));
    for(const [index,row] of rows.entries()) {
      const session=`session-${index}`;
      const raw=join(root,"raw",row.run_id); await mkdir(raw,{recursive:true});
      await writeFile(join(raw,"bridge-events.json"),"[]"); await writeFile(join(raw,"client-stream.jsonl"),"");
      await writeFile(join(root,"runs",row.run_id+".json"),JSON.stringify({session_id:session,actual_tools:[],started_at:"2026-09-06T00:00:00Z",ended_at:"2026-09-06T00:01:00Z"}));
      db.prepare("INSERT INTO proxy_kv VALUES(?,?)").run(`ttl/test/researcher/claude-code/${session}/inj-sess.json`,Buffer.from(JSON.stringify({status:"initialized",sessionInfo:{...row.identity,space_id:"test",session_id:session,user_id:"researcher"}})));
    }
    const result=await auditPilotResults(root,lab);
    expect(result).toMatchObject({checked_runs:2,distinct_sessions:2,distinct_variant_users:1,issues:[]});
    rows[1]!.identity=rows[0]!.identity;
    await writeFile(join(root,"manifest.json"),JSON.stringify(rows));
    db.prepare("UPDATE proxy_kv SET v=? WHERE k=?").run(Buffer.from(JSON.stringify({status:"initialized",sessionInfo:{...rows[0]!.identity,space_id:"test",session_id:"session-1",user_id:"researcher"}})),"ttl/test/researcher/claude-code/session-1/inj-sess.json");
    expect((await auditPilotResults(root,lab)).issues).toContain("run-2: Agent 或 Task 被其他运行复用");
  } finally {db.close();await rm(root,{recursive:true,force:true});}
});
