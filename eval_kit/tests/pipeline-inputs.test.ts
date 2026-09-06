import { expect, it } from "vitest";
import { isolateSeedSessions, resolveSessionQuery } from "../pipeline/inputs.js";
it("同一份 Memory 用于不同任务或重复实验时，不共用提炼 Session ID；对话正文保持原样", () => {
  const source = [{sessionId:"original",filePath:"/seed.json",messages:[{role:"user" as const,content:"按约定执行",timestamp:"2026-01-01T00:00:00.000Z"}]}];
  const a = isolateSeedSessions(source,"run-1","task-01");
  const b = isolateSeedSessions(source,"run-1","task-02");
  const c = isolateSeedSessions(source,"run-2","task-01");
  expect(new Set([a[0]!.session_id,b[0]!.session_id,c[0]!.session_id]).size).toBe(3);
  expect(a[0]).toMatchObject({source_session_id:"original",messages:[{role:"user",content:"按约定执行",timestamp:"2026-01-01T00:00:00.000Z"}]});
  expect(source[0]!.sessionId).toBe("original");
});

it("执行 Query 使用实际导入 ID，复用冻结数据时也不猜测新 ID", () => {
  const original = "请读取 `history-1`，不要把 history-10 当成同一个会话。";
  expect(resolveSessionQuery(original, [{source_session_id:"history-1", session_id:"seed-old-task-01-1"}]))
    .toBe("请读取 `seed-old-task-01-1`，不要把 history-10 当成同一个会话。");
  expect(original).toContain("`history-1`");
  expect(resolveSessionQuery("修改普通函数", [])).toBe("修改普通函数");
});

it("多个会话一次替换，不把替换结果再次当成原 ID", () => {
  expect(resolveSessionQuery("`a` 和 `b`", [
    {source_session_id:"a",session_id:"b"}, {source_session_id:"b",session_id:"c"},
  ])).toBe("`b` 和 `c`");
});
