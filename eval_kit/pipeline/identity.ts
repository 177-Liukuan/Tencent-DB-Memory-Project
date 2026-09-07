import type { Variant } from "../types.js";

export type Connection = { variant:Variant; userKey:string; gatewayKey:string; userId:string; baseUrl:string; serviceId:string };

export async function coreApi<T>(connection: Connection, path: string, body: unknown): Promise<T> {
  const response = await fetch(connection.baseUrl + path, {
    method:"POST", headers:{"content-type":"application/json","x-tdai-service-id":connection.serviceId,
      "x-tdai-user-key":connection.userKey,authorization:"Bearer " + connection.gatewayKey},
    body:JSON.stringify(body), signal:AbortSignal.timeout(60_000),
  });
  const result = await response.json() as { code:number;message?:string;data:T };
  if (!response.ok || result.code !== 0) throw new Error(`${connection.variant} ${path}: ${result.code ?? response.status} ${result.message ?? ""}`);
  return result.data;
}

// Team 只负责归组；使用真实查看者的账号创建，避免 member 看不到别人的私有 Agent 资产。
export async function createEvaluationTeam(connection: Connection, experimentId: string, members: string[]): Promise<string> {
  const team = await coreApi<{team_id:string}>(connection,"/v3/meta/team/create",{
    name:`${experimentId}-${connection.variant}`,owner_user_id:connection.userId,description:"评测工作区",
  });
  for (const userId of new Set(members)) {
    // 创建者已是 owner/admin；再次以 member 添加自己会被接口拒绝。
    if (userId === connection.userId) continue;
    await coreApi(connection,"/v3/meta/team-member/add",{team_id:team.team_id,user_id:userId,role:"member"});
  }
  return team.team_id;
}

// 同组复用账号和 Team，但每个任务新建 Agent；Memory 和自有 Skill 仍按 Agent 保存。
export async function createEvaluationTask(connection: Connection, teamId: string, number: number) {
  const agent = await coreApi<{agent_id:string}>(connection,"/v3/meta/agent/create",{
    team_id:teamId,owner_user_id:connection.userId,name:`agent_${number}`,
    description:"处理通用开发任务与日常协作",visibility:"private",
  });
  const task = await coreApi<{task_id:string}>(connection,"/v3/meta/task/create",{
    team_id:teamId,creator_user_id:connection.userId,title:`task_${number}`,description:"完成用户请求",
    linked_agents:[{agent_id:agent.agent_id}],
  });
  return {service_id:connection.serviceId,team_id:teamId,agent_id:agent.agent_id,task_id:task.task_id};
}
