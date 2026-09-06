import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createViewerApp, resolveWithin } from "../viewer/server.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "eval-viewer-")); roots.push(root);
  const exp = join(root, "exp-a");
  await mkdir(join(exp, "runs"), { recursive: true });
  const save = (name: string, value: unknown) => writeFile(join(exp, name), JSON.stringify(value));
  const prepared = (variant: "baseline" | "native", caseId = "case-a", repeat = 1) => ({
    run_id: `${caseId}-${variant}-${repeat}`, case_id: caseId, variant, repeat, seed_version: "seed-1", workspace: "/private/work",
    identity: { service_id: "svc", team_id: `team-${variant}`, agent_id: `${caseId}-${variant}-${repeat}`, task_id: `${caseId}-${variant}-${repeat}` },
  });
  const result = (variant: "baseline" | "native", extra = {}) => ({
    ...prepared(variant), session_id: `session-${variant}`, suite: "main", tool_family: "memory", query: "查询偏好",
    should_call: true, expected_tools: ["tdai_memory_search"], observation_valid: true, completed: true,
    actual_tools: ["tdai_memory_search"], end_to_end_ms: variant === "baseline" ? 2000 : 1000,
    tool_calls: [{ event_id: "event-1", session_id: `session-${variant}`, tool_name: "tdai_memory_search", tool_family: "memory",
      timestamp: "2026-09-05T01:00:00.000Z", call_id: variant === "native" ? "call-1" : null }],
    final_answer: "<img src=x onerror=alert(1)>", ...extra,
  });
  await save("config.json", { version: 2, experiment_id: "exp-a", model: "test-model", auth_key: "DO-NOT-EXPOSE" });
  await save("manifest.json", [prepared("baseline"), prepared("native")]);
  await save("runs/case-a-baseline-1.json", result("baseline"));
  await save("runs/case-a-native-1.json", result("native"));
  return { root, exp, save, prepared, result, app: createViewerApp({ resultsRoot: root }) };
}

describe("Bridge viewer API", () => {
  it("reads manifest and runs without cases.jsonl or a precomputed summary", async () => {
    const { app } = await fixture();
    const response = await app.request("/api/experiments");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await response.json()).toMatchObject([{ experiment_id: "exp-a", model: "test-model" }]);
    const overview = await app.request("/api/experiments/exp-a/overview");
    expect(overview.status).toBe(200);
    const data = await overview.json();
    expect(data.progress).toEqual({ planned: 2, recorded: 2, pending: 0, damaged: 0, invalid: 0 });
    expect(data.items).toHaveLength(2);
    expect(data.items[0]).toMatchObject({ outcome: "correct", observation_valid: true });
    expect(data.items[0]).not.toHaveProperty("final_answer");
    expect(data.summary.baseline.false_call_rate).toBeNull();
    expect(data.summary.paired_latency).toEqual({ pairs: 1, cases: 1, baseline_mean_ms: 2000, native_mean_ms: 1000, native_change_percent: -50 });
    expect(JSON.stringify(data)).not.toContain("DO-NOT-EXPOSE");
  });

  it("distinguishes wrong selection, missed tools, false calls and invalid collection", async () => {
    const { app, save, result } = await fixture();
    for (const [extra, outcome] of [
      [{ actual_tools: ["skill_search"], tool_calls: undefined }, "wrong_tool"],
      [{ actual_tools: [], tool_calls: [] }, "missed"],
      [{ should_call: false, expected_tools: [] }, "false_call"],
      [{ should_call: false, expected_tools: [], actual_tools: [], tool_calls: [] }, "correct"],
      [{ observation_valid: false, end_to_end_ms: null, error: "Observer unavailable" }, "invalid"],
    ] as const) {
      await save("runs/case-a-native-1.json", result("native", extra));
      const response = await app.request("/api/experiments/exp-a/runs/case-a-native-1");
      expect((await response.json()).outcome).toBe(outcome);
    }
    const data = await (await app.request("/api/experiments/exp-a/overview")).json();
    expect(data.summary.native.valid_samples).toBe(0);
    expect(data.summary.native.effective_call_rate).toBeNull();
    expect(data.summary.paired_latency.pairs).toBe(0);
  });

  it("uses scorer sequence rules and preserves repeated calls in file order", async () => {
    const { app, save, result } = await fixture();
    await save("runs/case-a-native-1.json", result("native", {
      actual_tools: ["skill_view", "skill_search", "skill_view"], tool_calls: undefined,
      allowed_sequences: [["skill_search", "skill_view"]],
    }));
    const data = await (await app.request("/api/experiments/exp-a/runs/case-a-native-1")).json();
    expect(data.outcome).toBe("wrong_tool");
    expect(data.actual_tools).toEqual(["skill_view", "skill_search", "skill_view"]);
    expect(data.final_answer).toBe("<img src=x onerror=alert(1)>");
  });

  it("shows planned and damaged runs without fabricating a zero score", async () => {
    const { app, save, prepared, exp } = await fixture();
    await save("manifest.json", [prepared("baseline"), prepared("native"), prepared("native", "pending")]);
    await writeFile(join(exp, "runs/case-a-native-1.json"), "{broken");
    const data = await (await app.request("/api/experiments/exp-a/overview")).json();
    expect(data.progress).toEqual({ planned: 3, recorded: 1, pending: 1, damaged: 1, invalid: 0 });
    expect(data.items.map((r: { outcome: string }) => r.outcome)).toEqual(["correct", "damaged", "pending"]);
    expect(data.summary.native.effective_call_rate).toBeNull();
  });

  it("separates suites and computes paired latency only within the selected suite", async () => {
    const { app, save, prepared, result } = await fixture();
    await save("manifest.json", [prepared("baseline"), prepared("native"), prepared("baseline", "probe"), prepared("native", "probe")]);
    for (const variant of ["baseline", "native"] as const) {
      await save(`runs/probe-${variant}-1.json`, { ...result(variant), ...prepared(variant, "probe"), suite: "probe",
        actual_tools: [], tool_calls: [], end_to_end_ms: variant === "baseline" ? 8000 : 4000 });
    }
    const main = await (await app.request("/api/experiments/exp-a/overview")).json();
    expect(main.selected_suite).toBe("main");
    expect(main.summary.native.effective_call_rate).toBe(1);
    const probe = await (await app.request("/api/experiments/exp-a/overview?suite=probe")).json();
    expect(probe.summary.native.effective_call_rate).toBe(0);
    expect(probe.summary.paired_latency.native_mean_ms).toBe(4000);
    expect(probe.items).toHaveLength(2);
  });

  it("rejects mismatched run identity and refuses unlisted run files", async () => {
    const { app, save, result } = await fixture();
    await save("runs/case-a-native-1.json", result("native", { case_id: "another-case" }));
    expect((await app.request("/api/experiments/exp-a/runs/case-a-native-1")).status).toBe(422);
    await save("runs/secret.json", { credential: "secret" });
    expect((await app.request("/api/experiments/exp-a/runs/secret")).status).toBe(404);
  });

  it("rejects unavailable suites and damaged event arrays instead of showing empty success", async () => {
    const { app, save, result } = await fixture();
    expect((await app.request("/api/experiments/exp-a/overview?suite=probe")).status).toBe(400);
    await save("runs/case-a-native-1.json", result("native", { actual_tools: [], tool_calls: result("native").tool_calls }));
    expect((await app.request("/api/experiments/exp-a/runs/case-a-native-1")).status).toBe(422);
  });

  it("does not serve old experiments, raw credentials, traversal or symlink escapes", async () => {
    const { app, root, exp } = await fixture();
    expect(() => resolveWithin(root, "../secret")).toThrow(/outside/i);
    await mkdir(join(root, "old"));
    await writeFile(join(root, "old/config.json"), '{"version":1}');
    expect(await (await app.request("/api/experiments")).json()).toHaveLength(1);
    expect((await app.request("/api/experiments/old/overview")).status).toBe(422);
    expect((await app.request("/api/experiments/%2e%2e/runs/config")).status).toBeGreaterThanOrEqual(400);
    await symlink(exp, join(root, "alias"));
    const outside = await mkdtemp(join(tmpdir(), "eval-viewer-outside-")); roots.push(outside);
    await writeFile(join(outside, "config.json"), '{"version":2,"model":"private"}');
    await symlink(outside, join(root, "escape"));
    expect((await app.request("/api/experiments/escape/overview")).status).toBeGreaterThanOrEqual(400);
    expect((await app.request("/api/experiments/exp-a/raw/run/claude-config/settings.json")).status).toBe(404);
    expect((await app.request("/raw/run/claude-config/settings.json")).status).toBe(404);
  });

  it("does not list preparation directories that contain a copied experiment config", async () => {
    const { app, root } = await fixture();
    await mkdir(join(root, "preparation"));
    await writeFile(join(root, "preparation/config.json"), JSON.stringify({ version: 2, experiment_id: "exp-a", model: "test-model" }));
    const experiments = await (await app.request("/api/experiments")).json();
    expect(experiments).toHaveLength(1);
    expect((await app.request("/api/experiments/preparation/overview")).status).toBe(422);
  });
});
