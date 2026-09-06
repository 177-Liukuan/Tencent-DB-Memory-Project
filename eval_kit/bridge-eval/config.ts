import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/);
const identity = z.object({ service_id: id, team_id: id, agent_id: id, task_id: id }).strict();
const runSchema = z.object({
  run_id: id, case_id: id, variant: z.enum(["baseline", "native"]), repeat: z.number().int().positive().default(1),
  seed_version: z.string().min(1), workspace: z.string().min(1), identity,
  auth_key_file: z.string().min(1).optional(),
  stop_after_tools:z.array(z.string().min(1)).optional(),
}).strict();
export type PreparedRun = z.infer<typeof runSchema>;
const variant = z.object({
  proxy_base_url: z.string().url(), observation_dir: z.string().min(1),
  env_file: z.string().min(1), auth_key_file: z.string().min(1),
  session_state_db: z.string().min(1).optional(),
}).strict();
const configSchema = z.object({
  version: z.literal(2), experiment_id: id, dataset: z.string().min(1), run_manifest: z.string().min(1),
  results_dir: z.string().min(1), claude_binary: z.string().min(1), model: z.string().min(1),
  timeout_ms: z.number().int().positive().default(300_000),
  allow_bash: z.boolean().default(false),
  client_image: z.string().min(1).optional(),
  measurement:z.enum(["tool_calls","end_to_end"]).default("end_to_end"),
  variants: z.object({ baseline: variant, native: variant }).strict(),
}).strict();
export type ObservationConfig = z.infer<typeof configSchema>;

export function validateRunManifest(raw: unknown): PreparedRun[] {
  const runs = z.array(runSchema).min(1).parse(raw);
  const seen = new Set<string>();
  const seeds = new Map<string, string>();
  for (const run of runs) {
    // Team 和账号可在一轮内共用；Agent/Task 不能复用，避免历史写入落到其他任务。
    for (const key of [run.run_id, run.variant + ":agent:" + run.identity.service_id + ":" + run.identity.agent_id,
      run.variant + ":task:" + run.identity.service_id + ":" + run.identity.task_id,
      run.variant + ":case:" + run.case_id + ":" + run.repeat]) {
      if (seen.has(key)) throw new Error("Duplicate run/Agent/Task or case repetition in manifest: " + run.run_id);
      seen.add(key);
    }
    const pair = run.case_id + ":" + run.repeat;
    if (seeds.has(pair) && seeds.get(pair) !== run.seed_version) throw new Error("Paired seed versions differ: " + pair);
    seeds.set(pair, run.seed_version);
  }
  return runs;
}

export async function loadObservationConfig(path: string): Promise<{ config: ObservationConfig; runs: PreparedRun[] }> {
  const base = dirname(resolve(path));
  const config = configSchema.parse(yaml.load(await readFile(path, "utf8")));
  for (const key of ["dataset", "run_manifest", "results_dir", "claude_binary"] as const) config[key] = resolve(base, config[key]);
  for (const v of Object.values(config.variants)) {
    for (const key of ["observation_dir", "env_file", "auth_key_file"] as const) v[key] = resolve(base, v[key]);
    if (v.session_state_db) v.session_state_db = resolve(base,v.session_state_db);
  }
  if (config.variants.baseline.observation_dir === config.variants.native.observation_dir
    || config.variants.baseline.proxy_base_url === config.variants.native.proxy_base_url) {
    throw new Error("Baseline and Native must use distinct proxies and observation directories");
  }
  const runs = validateRunManifest(JSON.parse(await readFile(config.run_manifest, "utf8")));
  for (const run of runs) {
    run.workspace = resolve(dirname(config.run_manifest), run.workspace);
    if (run.auth_key_file) run.auth_key_file = resolve(dirname(config.run_manifest),run.auth_key_file);
  }
  return { config, runs };
}
