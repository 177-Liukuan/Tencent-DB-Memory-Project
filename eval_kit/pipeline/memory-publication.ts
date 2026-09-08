import { DatabaseSync } from "node:sqlite";
import { copyMemorySeed, type SeedEndpoint } from "./memory-seed.js";
import { coreApi, type Connection } from "./identity.js";

// 离线底稿保持可复用；发布后的可读性按 Bridge 实际携带的完整身份检查。
export async function publishMemorySeed(
  source: SeedEndpoint, target: SeedEndpoint, connection: Connection,
  taskId: string, recordIdNamespace?: string,
) {
  if (!taskId.trim()) throw new Error("发布 Memory 必须指定运行 Task");
  const copied = await copyMemorySeed(source, target, recordIdNamespace);
  const { team_id, user_id, agent_id } = target.identity;
  const db = new DatabaseSync(target.dbPath);
  let sessions: Array<{ session_id: string; total: number }>;
  try {
    db.exec("PRAGMA busy_timeout=10000");
    db.exec("BEGIN IMMEDIATE");
    try {
      // 管理面的 Task-Agent 关联不改变记忆行；记录与 BM25 索引都需要发布到运行 Task。
      for (const table of ["l0_conversations", "l1_records", "l0_fts", "l1_fts"]) {
        db.prepare(`UPDATE ${table} SET task_id=? WHERE team_id=? AND user_id=? AND agent_id=?`)
          .run(taskId, team_id, user_id, agent_id);
        const count = db.prepare(`SELECT count(*) AS n FROM ${table}
          WHERE team_id=? AND user_id=? AND agent_id=? AND task_id=?`).get(team_id, user_id, agent_id, taskId);
        if (count?.n !== copied.counts[table]) throw new Error(`Memory ${table} 的 Task 归属核对失败`);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    sessions = db.prepare(`SELECT session_id, count(*) AS total FROM l0_conversations
      WHERE team_id=? AND user_id=? AND agent_id=? GROUP BY session_id ORDER BY session_id`)
      .all(team_id, user_id, agent_id) as Array<{ session_id: string; total: number }>;
  } finally { db.close(); }

  const body = { ...target.identity, task_id: taskId, limit: 1, offset: 0 };
  const check = (label: string, expected: number, total: number, page: unknown[]) => {
    if (total !== expected || !Array.isArray(page) || page.length !== Math.min(1, expected)) {
      throw new Error(`${connection.variant} Memory ${label} 在 Task ${taskId} 下不可完整读取：预期 ${expected} 条，实际 ${total} 条`);
    }
  };
  const l0 = await coreApi<{ total: number; messages: unknown[] }>(connection, "/v3/conversation/query", body);
  check("L0", copied.counts.l0_conversations!, l0.total, l0.messages);
  const l1 = await coreApi<{ total: number; items: unknown[] }>(connection, "/v3/atomic/query", body);
  check("L1", copied.counts.l1_records!, l1.total, l1.items);
  for (const session of sessions) {
    const result = await coreApi<{ total: number; messages: unknown[] }>(connection, "/v3/conversation/query",
      { ...body, session_id: session.session_id });
    check(`会话 ${session.session_id}`, session.total, result.total, result.messages);
  }
  // digest 是绑定 Task 前已核对的内容指纹；两组不同的 Task 身份由 apiCheck 单独核对。
  return { ...copied, apiCheck: { variant: connection.variant, task_id: taskId, l0: l0.total, l1: l1.total, sessions } };
}
