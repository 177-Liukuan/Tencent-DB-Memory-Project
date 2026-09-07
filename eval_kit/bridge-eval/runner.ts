import { cp, mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { loadObservationConfig, type PreparedRun } from "./config.js";
import { normalizeBridgeEvents, summarizeObservationRuns, type ObservationRun } from "./observations.js";
import { loadDataset } from "../runner/dataset-loader.js";
import { runClaudeClient, type ClientRunInput, type ClientRunResult } from "../runner/client.js";
import { secureWriteJson, secureWrite, readJsonl } from "../lib/fs.js";
import { toolFamily } from "../metrics/tool.js";
import { verifySessionInitialization } from "./session-initialization.js";

type Health = { enabled: boolean; healthy: boolean; started_at: string; error?: string };
async function checkObserver(baseUrl: string, directory: string, fetcher: typeof fetch): Promise<Health> {
  const response = await fetcher(new URL("/health", baseUrl), { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error("Proxy health check failed");
  const body = await response.json() as { toolObservation?: Health };
  const status = body.toolObservation;
  if (!status?.enabled || !status.healthy || !status.started_at) throw new Error("Tool observation is disabled or unhealthy");
  const marker = JSON.parse(await readFile(join(directory, "observer.json"), "utf8")) as Health;
  if (marker.started_at !== status.started_at) throw new Error("Observation directory does not belong to this Proxy process");
  return status;
}

export async function runObservationExperiment(path: string, deps: {
  runClient?: (input: ClientRunInput) => Promise<ClientRunResult>;
  fetcher?: typeof fetch;
} = {}) {
  const { config, runs: prepared } = await loadObservationConfig(path);
  const dataset = await loadDataset(config.dataset);
  const cases = new Map(dataset.cases.map(c => [c.case_id, c]));
  // 先把全部输入检查完，不能运行到一半才发现后面的案例或工作区不存在。
  for (const run of prepared) {
    if (!cases.has(run.case_id)) throw new Error("Unknown case: " + run.case_id);
    const c = cases.get(run.case_id)!;
    if (c.tool_family === "knowledge" || c.expected_tools.some(name => !["memory", "skill"].includes(toolFamily(name) ?? ""))) {
      throw new Error("Bridge observation evaluates Memory/Skill only: " + run.case_id);
    }
    if (!(await stat(run.workspace)).isDirectory()) throw new Error("Workspace is not a directory: " + run.run_id);
  }
  const fetcher = deps.fetcher ?? fetch;
  for (const variant of new Set(prepared.map(r => r.variant))) {
    const target = config.variants[variant]; await checkObserver(target.proxy_base_url, target.observation_dir, fetcher);
  }
  const directory = join(config.results_dir, config.experiment_id);
  await mkdir(config.results_dir, { recursive: true, mode: 0o700 });
  // 已跑过的实验不原地覆盖，也不隐式复用已经产生 Memory/Skill 的 Agent。
  await mkdir(directory, { mode: 0o700 });
  await secureWriteJson(join(directory, "config.json"), config);
  await secureWriteJson(join(directory, "manifest.json"), prepared);
  const output: Array<ObservationRun & Record<string, unknown>> = [];
  for (const preparedRun of prepared) {
    const testCase = cases.get(preparedRun.case_id)!;
    const target = config.variants[preparedRun.variant];
    const raw = join(directory, "raw", preparedRun.run_id);
    await mkdir(raw, { recursive: true, mode: 0o700 });
    const sessionId = randomUUID();
    const run: ObservationRun & Record<string, unknown> = {
      ...preparedRun, session_id: sessionId, suite: testCase.suite,
      query: testCase.query, tool_family: testCase.tool_family ?? "none",
      should_call: testCase.should_call, expected_tools: testCase.expected_tools,
      ...(testCase.allowed_first_tools ? { allowed_first_tools: testCase.allowed_first_tools } : {}),
      ...(testCase.expected_tool_sequence ? { expected_tool_sequence: testCase.expected_tool_sequence } : {}),
      ...(testCase.allowed_sequences ? { allowed_sequences: testCase.allowed_sequences } : {}),
      observation_valid: false, completed: false, actual_tools: [], end_to_end_ms: null,
      measurement:config.measurement,
    };
    try {
      const before = await checkObserver(target.proxy_base_url, target.observation_dir, fetcher);
      const claims = join(target.observation_dir, ".used-agents", preparedRun.identity.service_id);
      await mkdir(claims, { recursive: true, mode: 0o700 });
      // 独占创建是防误复用，不是执行租约：失败的实验也不自动释放 Agent。
      await writeFile(join(claims, preparedRun.identity.agent_id + ".json"),
        JSON.stringify({ experiment_id: config.experiment_id, run_id: preparedRun.run_id, session_id: sessionId }),
        { flag: "wx", mode: 0o600 });
      const work = join(raw, "workspace");
      await cp(preparedRun.workspace, work, { recursive: true, errorOnExist: true, force: false });
      const client = await (deps.runClient ?? runClaudeClient)({
        binary: config.claude_binary, variant: preparedRun.variant, testCase, sessionId,
        workDirectory: work, claudeConfigDirectory: join(raw, "claude-config"),
        envFile: target.env_file, authKeyFile: preparedRun.auth_key_file ?? target.auth_key_file, baseUrl: target.proxy_base_url,
        identity: preparedRun.identity, timeoutMs: config.timeout_ms, streamPath: join(raw, "client-stream.jsonl"),
        evaluation: { model: config.model, allowBash: config.allow_bash, ...(config.client_image ? {image:config.client_image} : {}) },
        ...(config.measurement==="tool_calls" ? {observationStop:{file:join(target.observation_dir,sessionId+".jsonl"),tools:preparedRun.stop_after_tools??[]}} : {}),
      });
      await secureWrite(join(raw, "client-stderr.log"), client.stderr);
      run.started_at = client.startedAt; run.ended_at = client.endedAt;
      const events = await readJsonl(join(target.observation_dir, sessionId + ".jsonl"));
      await secureWriteJson(join(raw, "bridge-events.json"), events);
      const calls = normalizeBridgeEvents(events, sessionId, preparedRun.variant)
        .filter(call=>!client.observationStoppedAt || Date.parse(call.timestamp)<=Date.parse(client.observationStoppedAt));
      run.stopped_on_observation=client.stoppedOnObservation??false;
      run.observation_stopped_at=client.observationStoppedAt??null;
      run.actual_tools = calls.map(e => e.tool_name);
      run.tool_calls = calls;
      const final = client.events.findLast(e => e.type === "result");
      run.final_answer = final?.result ?? null;
      run.completed = client.exitCode === 0 && !client.timedOut && !!final
        && final.is_error !== true && !String(final.subtype ?? "").startsWith("error") && !!client.completedAt;
      const after = await checkObserver(target.proxy_base_url, target.observation_dir, fetcher);
      if (after.started_at !== before.started_at) throw new Error("Proxy restarted during evaluation");
      if (target.session_state_db) run.session_initialization = verifySessionInitialization(target.session_state_db,sessionId,preparedRun.identity);
      // 发起事实与最终回答分开：工具已经被可靠记录，后续编码超时不能抹掉这次调用。
      // 反过来，模型请求失败且没有调用时，不能把它当作正常的“未调用”负样本。
      run.observation_valid = run.completed || calls.length>0;
      if (client.stoppedOnObservation && calls.length>0) {
        run.stop_reason="工具观测达到指定步骤；不测量本次完整任务延迟";
        run.completed=false;
      } else {
        if (!run.completed) throw new Error(client.timedOut ? "Claude timed out"
          : typeof final?.result === "string" && final.result ? final.result : "Claude did not return a successful final result");
        if (config.measurement==="end_to_end") run.end_to_end_ms = Date.parse(client.completedAt!) - Date.parse(client.startedAt);
        run.observation_valid = true;
      }
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
    }
    output.push(run);
    await secureWriteJson(join(directory, "runs", preparedRun.run_id + ".json"), run);
    await secureWriteJson(join(directory, "summary.json"), summarizeObservationRuns(output));
    process.stderr.write("[bridge-eval] " + run.run_id + ": " + (run.observation_valid ? run.actual_tools.join(", ") || "no tool" : "INVALID") + "\n");
  }
  return { experimentDirectory: directory, runs: output, summary: summarizeObservationRuns(output) };
}

export async function scoreObservationExperiment(directory: string) {
  const manifest = JSON.parse(await readFile(join(directory, "manifest.json"), "utf8")) as PreparedRun[];
  const runs: ObservationRun[] = [];
  for (const row of manifest) {
    try { runs.push(JSON.parse(await readFile(join(directory, "runs", row.run_id + ".json"), "utf8")) as ObservationRun); }
    catch { throw new Error("Incomplete or damaged run result: " + row.run_id); }
  }
  const summary = summarizeObservationRuns(runs);
  await secureWriteJson(join(directory, "summary.json"), summary);
  return summary;
}
