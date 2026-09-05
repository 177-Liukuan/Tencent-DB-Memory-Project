import { DatabaseSync } from "node:sqlite";
import type { PreparedRun } from "./config.js";

// 只读 Proxy 现有持久化状态，不增加业务埋点；最终回答成功不代表工具已成功注入。
export function verifySessionInitialization(dbPath:string,sessionId:string,identity:PreparedRun["identity"]) {
  const db = new DatabaseSync(dbPath,{readOnly:true});
  try {
    db.exec("PRAGMA busy_timeout=10000");
    const rows = db.prepare("SELECT v FROM proxy_kv WHERE k GLOB ?").all(`ttl/${identity.service_id}/*/claude-code/${sessionId}/inj-sess.json`) as Array<{v:Uint8Array}>;
    if (rows.length !== 1) throw new Error("Session Init state missing or ambiguous");
    const state = JSON.parse(Buffer.from(rows[0]!.v).toString("utf8"));
    const info = state.sessionInfo;
    if (state.status !== "initialized" || state.bypassed || !info) throw new Error("Session Init bypassed or incomplete; tool injection was not available");
    if (info.session_id !== sessionId || info.space_id !== identity.service_id || info.team_id !== identity.team_id
      || info.agent_id !== identity.agent_id || info.task_id !== identity.task_id) throw new Error("Session Init Agent/Task does not match the prepared run");
    return {initialized:true,user_id:info.user_id,team_id:info.team_id,agent_id:info.agent_id,task_id:info.task_id};
  } finally {db.close();}
}
