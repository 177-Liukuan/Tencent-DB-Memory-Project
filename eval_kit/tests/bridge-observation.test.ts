import { describe, expect, it } from "vitest";
import { normalizeBridgeEvents, summarizeObservationRuns } from "../bridge-eval/observations.js";
import { validateRunManifest } from "../bridge-eval/config.js";
const event = (id: string, call: string | null = null, name = "tdai_memory_search") => ({
  event_id: id, session_id: "session-1", tool_name: name, tool_family: name.startsWith("skill_") ? "skill" : "memory",
  timestamp: "2026-09-05T00:00:00.000Z", call_id: call,
});
describe("Bridge 观测统计", () => {
  it("按原文件顺序保留不同调用，只去掉重复采集和 Native 重试", () => {
    const rows = [event("e1", "c1"), event("e2", "c1"), event("e3", "c2"), event("e4", null, "skill_view")];
    expect(normalizeBridgeEvents([...rows, rows[0]!], "session-1", "native").map(e => e.tool_name))
      .toEqual(["tdai_memory_search", "tdai_memory_search", "skill_view"]);
  });
  it("Baseline 不凭相同名称或参数猜测重试；不同 Session、冲突调用 ID 必须报错", () => {
    expect(normalizeBridgeEvents([event("e1"), event("e2")], "session-1", "baseline")).toHaveLength(2);
    expect(() => normalizeBridgeEvents([event("e1")], "session-2", "native")).toThrow();
    expect(() => normalizeBridgeEvents([event("e1", "c1"), event("e2", "c1", "skill_view")], "session-1", "native")).toThrow();
  });
  it("按案例计算调用率，后端失败不影响发起事实，无效采集不作为未调用", () => {
    const row = (id: string, family: string, positive: boolean, tools: string[], valid = true) => ({
      run_id: id, case_id: id, variant: "native", suite: "main", tool_family: family,
      should_call: positive, expected_tools: family === "skill" ? ["skill_view"] : ["tdai_memory_search"],
      observation_valid: valid, completed: true, actual_tools: tools, end_to_end_ms: 100,
    });
    const summary = summarizeObservationRuns([
      row("p1", "memory", true, ["tdai_memory_search", "tdai_memory_search"]),
      row("p2", "skill", true, []),
      row("n1", "none", false, ["skill_view"]),
      row("n2", "none", false, []),
      row("broken", "memory", true, [], false),
    ] as any);
    expect(summary.native).toMatchObject({ effective_call_rate: 0.5, false_call_rate: 0.5, tool_selection_accuracy: 1, invalid_runs: 1 });
    expect(summary.native.by_tool_family.memory).toMatchObject({ effective_call_rate: 1, false_call_rate: 0 });
    expect(summary.native.by_tool_family.skill).toMatchObject({ effective_call_rate: 0, false_call_rate: 0.5 });
  });
  it("Agent 和 Team 不跨 Task 共用，配对资产版本必须一致", () => {
    const row = { run_id: "r1", case_id: "c1", variant: "native", repeat: 1, seed_version: "seed1",
      workspace: "/tmp/work", identity: { service_id: "space", team_id: "team", agent_id: "agent", task_id: "task" } };
    expect(() => validateRunManifest([row, { ...row, run_id: "r2", case_id: "c2" }])).toThrow();
    expect(() => validateRunManifest([row, { ...row, variant: "baseline", run_id: "b", seed_version: "different" }])).toThrow();
    expect(validateRunManifest([row, { ...row, variant: "baseline", run_id: "b" }])).toHaveLength(2);
  });
});

