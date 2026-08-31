import { access, chmod, mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runExperiment, scoreExperiment, type RunnerDependencies } from "../runner/runner.js";
import { timeToFirstAssistantMs } from "../runner/client.js";

describe("client timing", () => {
  it("measures TTFT from the first assistant event rather than CLI init output", () => {
    expect(timeToFirstAssistantMs([
      { type: "system", subtype: "init" },
      { type: "assistant", timestamp: "2026-08-31T00:00:00.250Z" },
      { type: "result", ttft_ms: 180, ttft_stream_ms: 125 },
    ], "2026-08-31T00:00:00.000Z", 10)).toBe(125);
    expect(timeToFirstAssistantMs([{ type: "system" }], "2026-08-31T00:00:00.000Z", 10)).toBe(10);
  });
});

async function fixture(): Promise<{ config: string; results: string }> {
  const root = await mkdtemp(join(tmpdir(), "eval-runner-"));
  const dataset = join(root, "dataset.jsonl");
  await writeFile(dataset, [
    { schema_version: 1, case_id: "positive", suite: "smoke", query: "find", should_call: true, expected_tool: "skill_view", tool_family: "skill" },
    { schema_version: 1, case_id: "negative", suite: "smoke", query: "2+2", should_call: false, answer_assertions: [{ operator: "exact", value: "4" }], tool_family: "none" },
  ].map((value) => JSON.stringify(value)).join("\n") + "\n");
  const seedWorkspace = join(root, "seed-workspace");
  await mkdir(seedWorkspace);
  await writeFile(join(seedWorkspace, "README.md"), "seed");
  const seedManifest = join(root, "seed.json");
  await writeFile(seedManifest, JSON.stringify({ instance: { id: "i" } }));
  const envFile = join(root, "claude.env");
  await writeFile(envFile, "ANTHROPIC_BASE_URL=http://127.0.0.1:9\nANTHROPIC_MODEL=fake-model\n");
  const authFile = join(root, "auth.key");
  await writeFile(authFile, "safe-test-token\n");
  await chmod(authFile, 0o600);
  const repo = join(root, "repo");
  await mkdir(repo);
  const results = join(root, "results");
  const config = join(root, "smoke.yaml");
  await writeFile(config, `
schema_version: 1
experiment_id: exp-test
calibration_only: true
dataset:
  name: fixture
  version: v1
  path: ${dataset}
results_dir: ${results}
random_seed: 20260831
run_timeout_ms: 1000
trace_poll_interval_ms: 0
trace_wait_timeout_ms: 100
prompt_version: v1
tool_schema_version: v1
model:
  provider: fake
  name: fake-model
claude:
  binary: /bin/false
lab:
  root: ${root}
  health_check: /bin/true
  preflight: /bin/true
  restore_seed: /bin/true
  seed_workspace: ${seedWorkspace}
  seed_manifest: ${seedManifest}
identity:
  service_id: i
  team_id: t
  agent_id: a
  task_id: k
langfuse:
  base_url: http://langfuse
  project_id: project-a
  public_key: test-public
  secret_key: test-secret
variants:
  baseline:
    repo_path: ${repo}
    expected_commit: baseline-commit
    proxy_base_url: http://127.0.0.1:9
    env_file: ${envFile}
    auth_key_file: ${authFile}
  native:
    repo_path: ${repo}
    expected_branch: research/native-tool
    proxy_base_url: http://127.0.0.1:9
    env_file: ${envFile}
    auth_key_file: ${authFile}
`);
  return { config, results };
}

function dependencies(overrides: Partial<RunnerDependencies> = {}): RunnerDependencies {
  return {
    preflight: vi.fn().mockResolvedValue({
      commits: { root: "root", baseline: "baseline-commit", native: "native-commit", lab: "lab" },
      versions: { node: process.version, claude: "fake", tokenizer: "fake" },
      worktrees: { baseline: { branch: "main", dirty: false, status_sha256: "clean" } },
    }),
    resetAssets: vi.fn().mockResolvedValue({ backup_path: "/backup/retained" }),
    runClient: vi.fn().mockImplementation(async ({ testCase, streamPath }) => {
      const toolEvents = testCase.should_call ? [
        { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `tool-${testCase.case_id}`, name: "skill_view", input: { name: "x" } }] } },
        { type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `tool-${testCase.case_id}`, content: "body" }] } },
      ] : [];
      const events = [...toolEvents, { type: "result", result: testCase.should_call ? "found" : "4", usage: { input_tokens: 10, output_tokens: 2 } }];
      await writeFile(streamPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n", { mode: 0o600 });
      return { events, exitCode: 0, timedOut: false, startedAt: "2026-08-31T00:00:00.000Z", endedAt: "2026-08-31T00:00:01.000Z", ttftMs: 10, stderr: "" };
    }),
    collectObservations: vi.fn().mockResolvedValue({ complete: true, observations: [{ id: "obs", type: "GENERATION", name: "fake-model", metadata: { protocol: "anthropic" }, traceId: "trace", startTime: "2026-08-31T00:00:00.000Z", endTime: "2026-08-31T00:00:01.000Z", model: "fake-model", input: { system: "s", messages: [], tools: [{ name: "skill_view", input_schema: { type: "object" } }] }, output: "answer", usageDetails: { input: 10, output: 2, total: 12 } }] }),
    queryClickhouse: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("experiment runner integration", () => {
  it("writes a complete 2×2 experiment with private permissions and can resume without rerunning", async () => {
    const { config, results } = await fixture();
    const deps = dependencies();
    const completed = await runExperiment(config, { resetAssets: true }, deps);
    expect(completed.runs).toHaveLength(4);
    expect(completed.summary.calibration_only).toBe(true);
    expect(deps.resetAssets).toHaveBeenCalledOnce();
    expect((await stat(join(results, "exp-test"))).mode & 0o777).toBe(0o700);
    expect((await stat(join(results, "exp-test", "config.json"))).mode & 0o777).toBe(0o600);
    await access(join(results, "exp-test", "raw", "positive--baseline", "client-stream.jsonl"));
    const snapshot = JSON.parse(await readFile(join(results, "exp-test", "config.json"), "utf8"));
    expect(JSON.stringify(snapshot)).not.toContain("test-secret");
    expect(JSON.stringify(snapshot)).not.toContain("test-public");
    expect(JSON.stringify(snapshot)).not.toContain("safe-test-token");
    expect(snapshot.harness.source_sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.harness.files["runner/runner.ts"]).toMatch(/^[a-f0-9]{64}$/);
    expect(snapshot.worktrees.baseline).toEqual({ branch: "main", dirty: false, status_sha256: "clean" });
    expect(snapshot.run_order_sha256).toMatch(/^[a-f0-9]{64}$/);

    const runPath = join(results, "exp-test", "runs", "positive--baseline.json");
    const damaged = JSON.parse(await readFile(runPath, "utf8"));
    damaged.model_calls = [];
    damaged.usage.provider = null;
    damaged.metrics = null;
    await writeFile(runPath, JSON.stringify(damaged));
    await scoreExperiment(join(results, "exp-test"));
    const rebuilt = JSON.parse(await readFile(runPath, "utf8"));
    expect(rebuilt.model_calls).toHaveLength(1);
    expect(rebuilt.usage.provider.total_tokens).toBe(12);
    expect(rebuilt.metrics).not.toBeNull();
    expect(rebuilt.case).toMatchObject({ query: "find", should_call: true, expected_tools: ["skill_view"] });
    expect(rebuilt.identity).toEqual({ service_id: "i", team_id: "t", agent_id: "a", task_id: "k" });

    const resumeDeps = dependencies();
    const resumed = await runExperiment(config, { resume: true }, resumeDeps);
    expect(resumed.runs).toHaveLength(4);
    expect(resumeDeps.runClient).not.toHaveBeenCalled();

    await expect(runExperiment(config, { resume: true, variants: new Set(["native"]) }, dependencies()))
      .rejects.toThrow(/run order|schedule/i);

    await writeFile(snapshot.dataset.path, '{"schema_version":1,"case_id":"changed","suite":"smoke","query":"changed","should_call":false}\n');
    await expect(scoreExperiment(join(results, "exp-test"))).rejects.toThrow(/dataset hash/i);
  });

  it("records timeout, incomplete trace and per-case infra failure without aborting the experiment", async () => {
    const { config } = await fixture();
    const base = dependencies();
    const runClient = vi.fn().mockImplementation(async (input) => {
      if (input.testCase.case_id === "positive" && input.variant === "baseline") throw new Error("fake crash");
      const result = await base.runClient(input);
      if (input.testCase.case_id === "negative" && input.variant === "native") return { ...result, timedOut: true, exitCode: null };
      return result;
    });
    const deps = dependencies({
      runClient,
      collectObservations: vi.fn().mockImplementation(async ({ runId }) => ({ complete: !runId.includes("positive--native"), observations: [] })),
    });
    const completed = await runExperiment(config, {}, deps);
    expect(completed.runs).toHaveLength(4);
    expect(completed.runs.find((run) => run.run_id === "positive--baseline")?.failure_tags).toContain("Infra Error");
    expect(completed.runs.find((run) => run.run_id === "positive--native")?.failure_tags).toContain("Trace Incomplete");
    expect(completed.runs.find((run) => run.run_id === "negative--native")?.failure_tags).toContain("Timeout");
  });
});
