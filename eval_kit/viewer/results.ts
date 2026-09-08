import { z } from "zod";
import { HTTPException } from "hono/http-exception";
import { isDeepStrictEqual } from "node:util";
import { validateRunManifest, type PreparedRun } from "../bridge-eval/config.js";
import { summarizeObservationRuns } from "../bridge-eval/observations.js";
import { selectionCorrect } from "../metrics/tool.js";
import { taskGroup } from "../metrics/task-group.js";

const suiteSchema = z.enum(["main", "smoke", "reliability", "probe"]);
const strings = z.array(z.string());
// 只向页面开放评测字段；不透传运行目录中的配置、凭据或未知扩展字段。
const resultSchema = z.object({
  run_id: z.string(), case_id: z.string(), variant: z.enum(["baseline", "native"]), repeat: z.number().int().positive().default(1),
  seed_version: z.string(), identity: z.object({ service_id: z.string(), team_id: z.string(), agent_id: z.string(), task_id: z.string() }),
  session_id: z.string(), suite: suiteSchema, tool_family: z.enum(["memory", "skill", "none"]), query: z.string(),
  should_call: z.boolean(), expected_tools: strings, allowed_first_tools: strings.optional(),
  expected_tool_sequence: strings.optional(), allowed_sequences: z.array(strings).optional(),
  observation_valid: z.boolean(), completed: z.boolean(), actual_tools: strings, end_to_end_ms: z.number().finite().nonnegative().nullable(),
  tool_calls: z.array(z.object({ event_id: z.string(), session_id: z.string(), tool_name: z.string(),
    tool_family: z.enum(["memory", "skill"]), timestamp: z.string().datetime(), call_id: z.string().nullable() })).optional(),
  started_at: z.string().datetime().optional(), ended_at: z.string().datetime().optional(),
  final_answer: z.unknown().optional(), error: z.string().optional(),
  stopped_on_observation: z.boolean().optional(), stop_reason: z.string().optional(),
  measurement: z.enum(["tool_calls", "end_to_end"]).optional(),
  latency_repeats: z.number().int().positive().optional(), latency_excluded_reason: z.string().optional(),
  not_started: z.boolean().optional(), timed_out: z.boolean().optional(), elapsed_ms: z.number().nonnegative().optional(),
  client_turns: z.number().nonnegative().optional(),
}).transform(({ allowed_first_tools, expected_tool_sequence, allowed_sequences, ...run }) => ({
  ...run,
  ...(allowed_first_tools ? { allowed_first_tools } : {}),
  ...(expected_tool_sequence ? { expected_tool_sequence } : {}),
  ...(allowed_sequences ? { allowed_sequences } : {}),
}));
type Run = z.infer<typeof resultSchema>;
type ReadJson = (child: string) => Promise<unknown>;
export const viewerConfigSchema = z.object({ version: z.literal(2), experiment_id: z.string(), model: z.string(),
  measurement: z.enum(["tool_calls", "end_to_end"]).optional() });

function outcome(run: Run) {
  if (run.measurement === "end_to_end") return run.latency_excluded_reason ? "excluded"
    : run.completed && run.observation_valid ? "responded" : "invalid";
  if (!run.observation_valid) return "invalid";
  if (!run.should_call) return run.actual_tools.length ? "false_call" : "correct";
  if (!run.actual_tools.length) return "missed";
  // 页面与 score 命令用同一套选择规则，不把“完成回答”等同于“选对工具”。
  return selectionCorrect({ schema_version: 1, ...run }, run.actual_tools) ? "correct" : "wrong_tool";
}

export async function readManifest(read: ReadJson) {
  try { return validateRunManifest(await read("manifest.json")); }
  catch { throw new HTTPException(422, { message: "运行清单缺失或损坏，无法读取该实验。" }); }
}

export async function readRun(read: ReadJson, row: PreparedRun) {
  const raw = await read(`runs/${row.run_id}.json`);
  try {
    const run = resultSchema.parse(raw);
    if (run.run_id !== row.run_id || run.case_id !== row.case_id || run.variant !== row.variant
      || run.repeat !== row.repeat || run.seed_version !== row.seed_version || !isDeepStrictEqual(run.identity, row.identity)
      || (!run.completed && run.end_to_end_ms !== null)) throw new Error("Run mismatch");
    if (run.tool_calls && (run.tool_calls.length !== run.actual_tools.length
      || run.tool_calls.some((e, i) => e.session_id !== run.session_id || e.tool_name !== run.actual_tools[i]))) throw new Error("Event mismatch");
    return { ...run, task_group: taskGroup(run), outcome: outcome(run) };
  } catch { throw new HTTPException(422, { message: `结果文件损坏或与运行清单不符：${row.run_id}` }); }
}

export async function readOverview(read: ReadJson, requestedSuite?: string) {
  const manifest = await readManifest(read);
  // 清单决定有哪些 Run，尚未生成结果的 Run 必须显示待运行，不能当成负样本。
  const loaded = await Promise.all(manifest.map(async (row) => {
    try { return { row, run: await readRun(read, row) }; }
    catch (error) {
      const missing = error instanceof HTTPException && error.status === 404;
      return { row, issue: missing ? "pending" as const : "damaged" as const };
    }
  }));
  const runs = loaded.flatMap(r => r.run ? [r.run] : []);
  const suites = [...new Set(runs.map(r => r.suite))].sort();
  const selected = requestedSuite ?? (suites.includes("main") ? "main" : suites[0] ?? "main");
  if (!suiteSchema.safeParse(selected).success || (suites.length > 0 && !suites.includes(selected as Run["suite"]))) {
    throw new HTTPException(400, { message: "该实验没有此评测分组，请重新选择实验。" });
  }
  const selectedRuns = runs.filter(r => r.suite === selected);
  const summary = summarizeObservationRuns(selectedRuns);
  summary.metric_suite = selected as Run["suite"];
  const items: Array<Record<string, unknown>> = [];
  for (const { row, run, issue } of loaded) {
    if (run) {
      if (run.suite !== selected) continue;
      // 列表不加载长回答与逐条事件，选中案例后才请求详情，避免首屏负担随对话长度增长。
      const { final_answer: _answer, tool_calls: _calls, ...item } = run;
      items.push(item);
    } else {
      items.push({ run_id: row.run_id, case_id: row.case_id, variant: row.variant, repeat: row.repeat,
        outcome: issue!, suite: null, query: "", actual_tools: [], end_to_end_ms: null });
    }
  }
  return { selected_suite: selected, suites: suites.length ? suites : [selected], summary, items,
    planned_pairs: new Set(manifest.map(r => JSON.stringify([r.case_id, r.repeat]))).size,
    progress: { planned: manifest.length, recorded: runs.length, pending: loaded.filter(r => r.issue === "pending").length,
      damaged: loaded.filter(r => r.issue === "damaged").length, invalid: runs.filter(r => !r.observation_valid).length } };
}
