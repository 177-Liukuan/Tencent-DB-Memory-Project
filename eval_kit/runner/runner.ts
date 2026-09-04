import { createHash, randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadDataset } from "./dataset-loader.js";
import { pairedDeltas, scoreRun, summarizeRuns } from "../metrics/index.js";
import { estimateDefinitionTokens, TOKENIZER_NAME } from "../metrics/token.js";
import { queryNativeToolCalls } from "../recorder/clickhouse-client.js";
import { LangfuseClient, pollStableObservations } from "../recorder/langfuse-client.js";
import { normalizeTrace } from "../recorder/trace-recorder.js";
import { proxyModelGenerationCount } from "../recorder/observations.js";
import type { CaseRun, EvalCase, Variant } from "../types.js";
import { readJsonl, secureDirectory, secureWrite, secureWriteJson, secureWriteJsonl } from "../lib/fs.js";
import { loadEvalConfig, parseEnvFile, type EvalConfig } from "./config.js";
import { runClaudeClient, timeToFirstAssistantMs, type ClientRunInput, type ClientRunResult } from "./client.js";
import { assertResumeCompatible, redactConfig, stableHash } from "./experiment.js";
import { restoreSeed, runPreflight, type PreflightResult } from "./preflight.js";
import { buildRunSchedule, type ScheduledRun } from "./scheduler.js";
import { startRequestTap } from "./tap.js";

export type RunnerOptions = {
  resetAssets?: boolean;
  resume?: boolean;
  caseIds?: Set<string>;
  variants?: Set<Variant>;
};

type ObservationInput = {
  runId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  expectedClientRequests: number;
  config: EvalConfig;
};

export type RunnerDependencies = {
  preflight: (config: EvalConfig) => Promise<PreflightResult>;
  resetAssets: (config: EvalConfig) => Promise<{ backup_path: string | null; output?: string }>;
  runClient: (input: ClientRunInput) => Promise<ClientRunResult>;
  collectObservations: (input: ObservationInput) => Promise<{ observations: Record<string, unknown>[]; complete: boolean }>;
  queryClickhouse: (input: ObservationInput) => Promise<Record<string, unknown>[]>;
};

type ExperimentOutput = {
  experimentDirectory: string;
  runs: CaseRun[];
  summary: Record<string, unknown>;
};

function defaultDependencies(): RunnerDependencies {
  return {
    preflight: runPreflight,
    resetAssets: restoreSeed,
    runClient: runClaudeClient,
    collectObservations: async (input) => {
      const credentials = await langfuseCredentials(input.config);
      const client = new LangfuseClient({
        baseUrl: input.config.langfuse.base_url,
        publicKey: credentials.publicKey,
        secretKey: credentials.secretKey,
      });
      return pollStableObservations(client, {
        sessionId: input.sessionId,
        fromStartTime: input.startedAt,
        toStartTime: new Date(Date.parse(input.endedAt) + 5_000).toISOString(),
        intervalMs: input.config.trace_poll_interval_ms,
        timeoutMs: input.config.trace_wait_timeout_ms,
        minimumProxyGenerations: input.expectedClientRequests,
      });
    },
    queryClickhouse: async (input) => {
      if (input.config.clickhouse?.enabled !== true) return [];
      return queryNativeToolCalls(input.config, input);
    },
  };
}

async function langfuseCredentials(config: EvalConfig): Promise<{ publicKey: string; secretKey: string }> {
  let publicKey = config.langfuse.public_key;
  let secretKey = config.langfuse.secret_key;
  if (config.langfuse.credentials_file) {
    const env = parseEnvFile(await readFile(config.langfuse.credentials_file, "utf8"));
    publicKey ??= env.LANGFUSE_PUBLIC_KEY ?? env.LANGFUSE_INIT_PROJECT_PUBLIC_KEY;
    secretKey ??= env.LANGFUSE_SECRET_KEY ?? env.LANGFUSE_INIT_PROJECT_SECRET_KEY;
  }
  if (!publicKey || !secretKey) throw new Error("Langfuse credentials are missing");
  return { publicKey, secretKey };
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

function elapsed(start: string, end: string): number | null {
  const value = Date.parse(end) - Date.parse(start);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function compactRun(run: CaseRun): Record<string, unknown> {
  return {
    run_id: run.run_id,
    case_id: run.case_id,
    query: run.case.query,
    expected_tools: run.case.expected_tools,
    variant: run.variant,
    status: run.status,
    final_answer: run.final_answer,
    tool_family: run.tool_family ?? "none",
    difficulty: run.difficulty ?? null,
    tags: run.tags ?? [],
    metrics: run.metrics,
    failure_tags: run.failure_tags,
    usage: run.usage,
    latency: run.latency,
    trace: run.trace,
  };
}

function caseDefinition(testCase: EvalCase): CaseRun["case"] {
  return {
    suite: testCase.suite,
    query: testCase.query,
    should_call: testCase.should_call,
    expected_tools: testCase.expected_tools,
    argument_assertions: testCase.argument_assertions ?? [],
    answer_assertions: testCase.answer_assertions ?? [],
  };
}

async function writeIndexes(experimentDirectory: string, experimentId: string, runs: CaseRun[], calibrationOnly: boolean): Promise<Record<string, unknown>> {
  const computed = summarizeRuns(runs);
  const summary: Record<string, unknown> = {
    schema_version: 1,
    experiment_id: experimentId,
    generated_at: new Date().toISOString(),
    calibration_only: calibrationOnly,
    total_runs: runs.length,
    ...computed,
    paired_deltas_native_minus_baseline: pairedDeltas(runs),
  };
  await secureWriteJsonl(join(experimentDirectory, "cases.jsonl"), runs.map(compactRun));
  await secureWriteJson(join(experimentDirectory, "summary.json"), summary);
  return summary;
}

async function prepareRunDirectories(config: EvalConfig, experimentDirectory: string, schedule: ScheduledRun): Promise<{ raw: string; work: string; claudeConfig: string }> {
  const raw = join(experimentDirectory, "raw", schedule.run_id);
  const runtimeRoot = resolve(config.results_dir, "..", ".work", config.experiment_id, schedule.run_id);
  const work = join(runtimeRoot, "workspace");
  const claudeConfig = join(runtimeRoot, "claude-config");
  await Promise.all([secureDirectory(raw), secureDirectory(work), secureDirectory(claudeConfig)]);
  await cp(config.lab.seed_workspace, work, { recursive: true, force: false, errorOnExist: false });
  return { raw, work, claudeConfig };
}

function artifactMap(experimentDirectory: string, paths: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(paths).map(([key, path]) => [key, relative(experimentDirectory, path)]));
}

async function executeRun(
  config: EvalConfig,
  experimentDirectory: string,
  testCase: EvalCase,
  schedule: ScheduledRun,
  deps: RunnerDependencies,
): Promise<CaseRun> {
  const dirs = await prepareRunDirectories(config, experimentDirectory, schedule);
  const streamPath = join(dirs.raw, "client-stream.jsonl");
  const tapPath = join(dirs.raw, "proxy-tap.jsonl");
  const observationsPath = join(dirs.raw, "langfuse-observations.json");
  const clickhousePath = join(dirs.raw, "clickhouse-tool-calls.json");
  await Promise.all([secureWrite(streamPath, ""), secureWrite(tapPath, "")]);
  const sessionId = randomUUID();
  const variantConfig = config.variants[schedule.variant];
  const tap = await startRequestTap({ targetBaseUrl: variantConfig.proxy_base_url, recordPath: tapPath });
  let client: ClientRunResult | null = null;
  let clientError: string | null = null;
  try {
    client = await deps.runClient({
      binary: config.claude.binary,
      variant: schedule.variant,
      testCase,
      sessionId,
      workDirectory: dirs.work,
      claudeConfigDirectory: dirs.claudeConfig,
      envFile: variantConfig.env_file,
      authKeyFile: variantConfig.auth_key_file,
      baseUrl: tap.baseUrl,
      identity: config.identity,
      timeoutMs: config.run_timeout_ms,
      streamPath,
    });
  } catch (error) {
    clientError = error instanceof Error ? error.message : String(error);
  } finally {
    await tap.close();
  }
  const now = new Date().toISOString();
  const startedAt = client?.startedAt ?? now;
  const endedAt = client?.endedAt ?? now;
  const tapEvents = await readJsonl(tapPath);
  const observationInput = {
    runId: schedule.run_id,
    sessionId,
    startedAt,
    endedAt,
    expectedClientRequests: tapEvents.filter((event) => event.kind === "request").length,
    config,
  };
  let observations: Record<string, unknown>[] = [];
  let traceComplete = false;
  let recorderError: string | null = null;
  if (client) {
    try {
      const collected = await deps.collectObservations(observationInput);
      observations = collected.observations;
      traceComplete = collected.complete;
    } catch (error) {
      recorderError = error instanceof Error ? error.message : String(error);
    }
  }
  let clickhouseRows: Record<string, unknown>[] = [];
  if (client && schedule.variant === "native") {
    try { clickhouseRows = await deps.queryClickhouse(observationInput); } catch { /* optional enrichment */ }
  }
  await Promise.all([
    secureWriteJson(observationsPath, observations),
    secureWriteJson(clickhousePath, clickhouseRows),
  ]);
  const clientEvents = client?.events ?? await readJsonl(streamPath);
  const normalized = normalizeTrace({
    variant: schedule.variant,
    tapEvents,
    clientEvents,
    observations,
    clickhouseRows,
    traceComplete,
    langfuseBaseUrl: config.langfuse.base_url,
    langfuseProjectId: config.langfuse.project_id ?? null,
  });
  const status: CaseRun["status"] = clientError || (client && !client.timedOut && client.exitCode !== 0)
    ? "infra_error"
    : client?.timedOut ? "timeout" : "completed";
  const definitionInput = normalized.model_calls.at(0)?.input;
  const run: CaseRun = {
    schema_version: 1,
    run_id: schedule.run_id,
    experiment_id: config.experiment_id,
    case_id: testCase.case_id,
    variant: schedule.variant,
    session_id: sessionId,
    identity: { ...config.identity },
    case: caseDefinition(testCase),
    status,
    started_at: startedAt,
    ended_at: endedAt,
    raw_request: normalized.raw_request,
    model_calls: normalized.model_calls,
    tool_calls: normalized.tool_calls,
    final_answer: normalized.final_answer,
    usage: {
      provider: normalized.usage,
      definition_tokens: !traceComplete || definitionInput === undefined ? null : estimateDefinitionTokens(schedule.variant, definitionInput),
    },
    latency: {
      end_to_end_ms: client ? elapsed(startedAt, endedAt) : null,
      ttft_ms: client?.ttftMs ?? null,
      tool_ms: normalized.tool_calls.flatMap((call) => call.latency_ms === null ? [] : [call.latency_ms]),
    },
    trace: {
      complete: traceComplete,
      langfuse_url: normalized.langfuse_url,
      artifacts: artifactMap(experimentDirectory, { client_stream: streamPath, proxy_tap: tapPath, langfuse_observations: observationsPath, clickhouse_tool_calls: clickhousePath }),
      client_request_count: tapEvents.filter((event) => event.kind === "request").length,
    },
    metrics: null,
    failure_tags: [],
    error: [clientError, recorderError, client && client.exitCode !== 0 ? client.stderr || `Claude exited ${client.exitCode}` : null].filter(Boolean).join("; ") || null,
  };
  return scoreRun(testCase, run);
}

function sha256(raw: string | Buffer): string {
  return createHash("sha256").update(raw).digest("hex");
}

async function assetSnapshot(config: EvalConfig): Promise<Record<string, unknown>> {
  const raw = await readFile(config.lab.seed_manifest, "utf8");
  return { path: config.lab.seed_manifest, sha256: sha256(raw), manifest: JSON.parse(raw) as unknown };
}

async function harnessSnapshot(): Promise<Record<string, unknown>> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const files: Record<string, string> = {};
  const visit = async (relativePath: string): Promise<void> => {
    const absolute = resolve(root, relativePath);
    const info = await stat(absolute);
    if (info.isDirectory()) {
      for (const entry of (await readdir(absolute)).sort()) await visit(join(relativePath, entry));
      return;
    }
    if (info.isFile()) files[relativePath] = sha256(await readFile(absolute));
  };
  for (const path of [
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "vitest.config.ts",
    "cli.ts",
    "types.ts",
    "lib",
    "metrics",
    "recorder",
    "runner",
    "viewer",
  ]) await visit(path);
  const packageJson = JSON.parse(await readFile(resolve(root, "package.json"), "utf8")) as { version?: string };
  return {
    package_version: packageJson.version ?? null,
    source_sha256: stableHash(files),
    files,
  };
}

async function existingRuns(experimentDirectory: string): Promise<CaseRun[]> {
  const directory = join(experimentDirectory, "runs");
  if (!await exists(directory)) return [];
  const files = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  return Promise.all(files.map(async (name) => JSON.parse(await readFile(join(directory, name), "utf8")) as CaseRun));
}

export async function runExperiment(
  configPath: string,
  options: RunnerOptions = {},
  suppliedDependencies?: RunnerDependencies,
): Promise<ExperimentOutput> {
  if (options.resume && options.resetAssets) throw new Error("--resume and --reset-assets cannot be used together");
  const { config, raw: rawConfig } = await loadEvalConfig(configPath);
  const dataset = await loadDataset(config.dataset.path);
  const schedule = buildRunSchedule(dataset.cases, config.random_seed, {
    ...(options.caseIds ? { caseIds: options.caseIds } : {}),
    ...(options.variants ? { variants: options.variants } : {}),
  });
  if (schedule.length === 0) throw new Error("The selected filters produce no runs");
  const experimentDirectory = join(config.results_dir, config.experiment_id);
  const snapshotPath = join(experimentDirectory, "config.json");
  const configHash = sha256(rawConfig);
  const present = await exists(experimentDirectory);
  if (present && !options.resume) throw new Error(`Experiment already exists and will not be overwritten: ${experimentDirectory}`);
  if (!present && options.resume) throw new Error(`Cannot resume missing experiment: ${experimentDirectory}`);
  if (present) {
    const existing = JSON.parse(await readFile(snapshotPath, "utf8")) as { config_hash: string; dataset_sha256: string; run_order?: ScheduledRun[] };
    assertResumeCompatible(existing, { config_hash: configHash, dataset_sha256: dataset.sha256 });
    if (!existing.run_order || stableHash(existing.run_order) !== stableHash(schedule)) {
      throw new Error("Cannot resume: selected run order does not match the existing experiment schedule");
    }
  }
  const deps = suppliedDependencies ?? defaultDependencies();
  const firstPreflight = await deps.preflight(config);
  const reset = options.resetAssets ? await deps.resetAssets(config) : null;
  const preflight = options.resetAssets ? await deps.preflight(config) : firstPreflight;
  await secureDirectory(config.results_dir);
  if (!present) {
    await mkdir(experimentDirectory, { mode: 0o700 });
    await Promise.all([
      secureDirectory(join(experimentDirectory, "runs")),
      secureDirectory(join(experimentDirectory, "raw")),
      secureDirectory(resolve(config.results_dir, "..", ".work", config.experiment_id)),
    ]);
    const snapshot = {
      schema_version: 1,
      experiment_id: config.experiment_id,
      created_at: new Date().toISOString(),
      calibration_only: config.calibration_only,
      dataset: { name: config.dataset.name, version: config.dataset.version, path: config.dataset.path, sha256: dataset.sha256, cases: dataset.cases.length },
      dataset_sha256: dataset.sha256,
      config_hash: configHash,
      source_config_sha256: configHash,
      commits: preflight.commits,
      model: config.model,
      versions: { ...preflight.versions, tokenizer_name: TOKENIZER_NAME },
      prompt_version: config.prompt_version,
      tool_schema_version: config.tool_schema_version,
      content_hashes: preflight.content_hashes ?? {},
      harness: await harnessSnapshot(),
      worktrees: preflight.worktrees ?? {},
      assets: await assetSnapshot(config),
      reset_assets: reset ? { requested: true, backup_path: reset.backup_path } : { requested: false, backup_path: null },
      concurrency: 1,
      random_seed: config.random_seed,
      run_order: schedule,
      run_order_sha256: stableHash(schedule),
      actual_configuration: redactConfig(config),
    };
    await secureWriteJson(snapshotPath, snapshot);
  }
  const runsById = new Map((await existingRuns(experimentDirectory)).map((run) => [run.run_id, run]));
  for (const scheduled of schedule) {
    if (runsById.has(scheduled.run_id)) continue;
    const testCase = dataset.cases.find((candidate) => candidate.case_id === scheduled.case_id);
    if (!testCase) throw new Error(`Scheduled unknown case: ${scheduled.case_id}`);
    let run: CaseRun;
    try {
      run = await executeRun(config, experimentDirectory, testCase, scheduled, deps);
    } catch (error) {
      const now = new Date().toISOString();
      run = scoreRun(testCase, {
        schema_version: 1,
        run_id: scheduled.run_id,
        experiment_id: config.experiment_id,
        case_id: scheduled.case_id,
        variant: scheduled.variant,
        session_id: randomUUID(),
        identity: { ...config.identity },
        case: caseDefinition(testCase),
        status: "infra_error",
        started_at: now,
        ended_at: now,
        raw_request: null,
        model_calls: [],
        tool_calls: [],
        final_answer: null,
        usage: { provider: null, definition_tokens: null },
        latency: { end_to_end_ms: null, ttft_ms: null, tool_ms: [] },
        trace: { complete: false, langfuse_url: null, artifacts: {} },
        metrics: null,
        failure_tags: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
    runsById.set(run.run_id, run);
    await secureWriteJson(join(experimentDirectory, "runs", `${run.run_id}.json`), run);
    await writeIndexes(experimentDirectory, config.experiment_id, [...runsById.values()], config.calibration_only);
  }
  const runs = schedule.flatMap((scheduled) => {
    const run = runsById.get(scheduled.run_id);
    return run ? [run] : [];
  });
  const summary = await writeIndexes(experimentDirectory, config.experiment_id, runs, config.calibration_only);
  return { experimentDirectory, runs, summary };
}

export async function scoreExperiment(experimentDirectory: string): Promise<Record<string, unknown>> {
  const absolute = resolve(experimentDirectory);
  const snapshot = JSON.parse(await readFile(join(absolute, "config.json"), "utf8")) as {
    experiment_id?: string;
    calibration_only?: boolean;
    dataset_sha256?: string;
    dataset?: { path?: string; sha256?: string };
    actual_configuration?: {
      identity?: CaseRun["identity"];
      langfuse?: { base_url?: string; project_id?: string | null };
    };
  };
  if (!snapshot.dataset?.path) throw new Error("Experiment snapshot does not contain the dataset path");
  const dataset = await loadDataset(snapshot.dataset.path);
  const expectedDatasetHash = snapshot.dataset.sha256 ?? snapshot.dataset_sha256;
  if (!expectedDatasetHash || dataset.sha256 !== expectedDatasetHash) {
    throw new Error("Cannot score experiment: dataset hash does not match the experiment snapshot");
  }
  const runs = await existingRuns(absolute);
  const rebuilt: CaseRun[] = [];
  for (const source of runs) {
    if (!/^[A-Za-z0-9._-]+$/u.test(source.run_id)) throw new Error(`Invalid persisted run_id: ${source.run_id}`);
    const testCase = dataset.cases.find((candidate) => candidate.case_id === source.case_id);
    if (!testCase) throw new Error(`Run ${source.run_id} references an unknown dataset case: ${source.case_id}`);
    const rawDirectory = join(absolute, "raw", source.run_id);
    const [tapEvents, clientEvents, observations, clickhouseRows] = await Promise.all([
      readJsonl(join(rawDirectory, "proxy-tap.jsonl")),
      readJsonl(join(rawDirectory, "client-stream.jsonl")),
      readFile(join(rawDirectory, "langfuse-observations.json"), "utf8").then((raw) => JSON.parse(raw) as Record<string, unknown>[]),
      readFile(join(rawDirectory, "clickhouse-tool-calls.json"), "utf8").then((raw) => JSON.parse(raw) as Record<string, unknown>[]),
    ]);
    const clientRequestCount = tapEvents.filter((event) => event.kind === "request").length;
    const traceComplete = source.status === "completed"
      && source.trace.complete
      && proxyModelGenerationCount(observations) >= clientRequestCount;
    const normalized = normalizeTrace({
      variant: source.variant,
      tapEvents,
      clientEvents,
      observations,
      clickhouseRows,
      traceComplete,
      langfuseBaseUrl: snapshot.actual_configuration?.langfuse?.base_url ?? "",
      langfuseProjectId: snapshot.actual_configuration?.langfuse?.project_id ?? null,
    });
    const definitionInput = normalized.model_calls.at(0)?.input;
    const rescored = scoreRun(testCase, {
      ...source,
      identity: snapshot.actual_configuration?.identity ?? source.identity,
      case: caseDefinition(testCase),
      raw_request: normalized.raw_request,
      model_calls: normalized.model_calls,
      tool_calls: normalized.tool_calls,
      final_answer: normalized.final_answer,
      usage: {
        provider: normalized.usage,
        definition_tokens: !traceComplete || definitionInput === undefined ? null : estimateDefinitionTokens(source.variant, definitionInput),
      },
      latency: {
        ...source.latency,
        ttft_ms: timeToFirstAssistantMs(clientEvents, source.started_at, source.latency.ttft_ms),
        tool_ms: normalized.tool_calls.flatMap((call) => call.latency_ms === null ? [] : [call.latency_ms]),
      },
      trace: {
        ...source.trace,
        complete: traceComplete,
        langfuse_url: normalized.langfuse_url,
        client_request_count: clientRequestCount,
      },
      metrics: null,
      failure_tags: [],
    });
    rebuilt.push(rescored);
    await secureWriteJson(join(absolute, "runs", `${rescored.run_id}.json`), rescored);
  }
  return writeIndexes(absolute, snapshot.experiment_id ?? basename(absolute), rebuilt, snapshot.calibration_only === true);
}
