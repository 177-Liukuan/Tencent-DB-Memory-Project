import { expect, it } from "vitest";
import { isolateSeedSessions } from "../pipeline/inputs.js";
it("同一份 Memory 用于不同任务或重复实验时，不共用提炼 Session ID；对话正文保持原样", () => {
  const source = [{sessionId:"original",filePath:"/seed.json",messages:[{role:"user" as const,content:"按约定执行",timestamp:"2026-01-01T00:00:00.000Z"}]}];
  const a = isolateSeedSessions(source,"run-1","task-01");
  const b = isolateSeedSessions(source,"run-1","task-02");
  const c = isolateSeedSessions(source,"run-2","task-01");
  expect(new Set([a[0]!.session_id,b[0]!.session_id,c[0]!.session_id]).size).toBe(3);
  expect(a[0]).toMatchObject({source_session_id:"original",messages:[{role:"user",content:"按约定执行",timestamp:"2026-01-01T00:00:00.000Z"}]});
  expect(source[0]!.sessionId).toBe("original");
});
