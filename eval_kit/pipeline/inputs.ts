import type { MemorySession } from "../importers/memories/importer.js";
export function isolateSeedSessions(sessions: MemorySession[], experimentId: string, taskLabel: string) {
  // Core 的部分提炼游标按 sessionKey 保存；不同 Agent 也不能复用导入会话 ID。
  return sessions.map((session,index) => ({source_session_id:session.sessionId,
    session_id:`seed-${experimentId}-${taskLabel}-${index+1}`,messages:session.messages}));
}
