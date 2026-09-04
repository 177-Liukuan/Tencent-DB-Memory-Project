import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import yaml from "js-yaml";
import { z } from "zod";

const pathString = z.string().min(1);
const variantSchema = z.object({
  repo_path: pathString,
  expected_commit: z.string().optional(),
  expected_branch: z.string().optional(),
  proxy_base_url: z.string().url(),
  env_file: pathString,
  auth_key_file: pathString,
});

const configSchema = z.object({
  schema_version: z.literal(1),
  experiment_id: z.string().regex(/^[A-Za-z0-9._-]+$/u),
  calibration_only: z.boolean().default(false),
  dataset: z.object({ name: z.string().min(1), version: z.string().min(1), path: pathString }),
  results_dir: pathString,
  random_seed: z.number().int(),
  run_timeout_ms: z.number().int().positive().default(300_000),
  trace_poll_interval_ms: z.number().int().nonnegative().default(2_000),
  trace_wait_timeout_ms: z.number().int().positive().default(60_000),
  prompt_version: z.string().min(1),
  tool_schema_version: z.string().min(1),
  model: z.object({ provider: z.string().min(1), name: z.string().min(1) }),
  claude: z.object({ binary: pathString }),
  root_repo: pathString.optional(),
  lab: z.object({
    root: pathString,
    health_check: pathString,
    preflight: pathString,
    restore_seed: pathString,
    seed_workspace: pathString,
    seed_manifest: pathString,
  }),
  identity: z.object({ service_id: z.string(), team_id: z.string(), agent_id: z.string(), task_id: z.string() }),
  langfuse: z.object({
    base_url: z.string().url(),
    project_id: z.string().nullable().optional(),
    credentials_file: pathString.optional(),
    public_key: z.string().optional(),
    secret_key: z.string().optional(),
  }),
  clickhouse: z.object({
    enabled: z.boolean().default(false),
    config_file: pathString.optional(),
    url: z.string().url().optional(),
    database: z.string().optional(),
  }).optional(),
  content_sources: z.array(pathString).optional(),
  variants: z.object({ baseline: variantSchema, native: variantSchema }),
}).strict();

export type EvalConfig = z.infer<typeof configSchema>;

function pathFrom(base: string, path: string): string {
  return isAbsolute(path) ? path : resolve(base, path);
}

export async function loadEvalConfig(path: string): Promise<{ config: EvalConfig; raw: string; path: string }> {
  const absolute = resolve(path);
  const raw = await readFile(absolute, "utf8");
  const parsed = configSchema.parse(yaml.load(raw));
  const base = dirname(absolute);
  const credentialsFile = parsed.langfuse.credentials_file ? pathFrom(base, parsed.langfuse.credentials_file) : undefined;
  let projectId = parsed.langfuse.project_id;
  if (!projectId && credentialsFile) {
    const credentials = parseEnvFile(await readFile(credentialsFile, "utf8"));
    projectId = credentials.LANGFUSE_PROJECT_ID ?? credentials.LANGFUSE_INIT_PROJECT_ID ?? null;
  }
  const config = {
    ...parsed,
    results_dir: pathFrom(base, parsed.results_dir),
    root_repo: pathFrom(base, parsed.root_repo ?? resolve(base, "../..")),
    dataset: { ...parsed.dataset, path: pathFrom(base, parsed.dataset.path) },
    claude: { binary: pathFrom(base, parsed.claude.binary) },
    lab: Object.fromEntries(Object.entries(parsed.lab).map(([key, value]) => [key, pathFrom(base, value)])) as EvalConfig["lab"],
    langfuse: {
      ...parsed.langfuse,
      project_id: projectId ?? null,
      ...(credentialsFile ? { credentials_file: credentialsFile } : {}),
    },
    clickhouse: parsed.clickhouse ? {
      ...parsed.clickhouse,
      ...(parsed.clickhouse.config_file ? { config_file: pathFrom(base, parsed.clickhouse.config_file) } : {}),
    } : undefined,
    content_sources: parsed.content_sources?.map((source) => pathFrom(base, source)),
    variants: {
      baseline: {
        ...parsed.variants.baseline,
        repo_path: pathFrom(base, parsed.variants.baseline.repo_path),
        env_file: pathFrom(base, parsed.variants.baseline.env_file),
        auth_key_file: pathFrom(base, parsed.variants.baseline.auth_key_file),
      },
      native: {
        ...parsed.variants.native,
        repo_path: pathFrom(base, parsed.variants.native.repo_path),
        env_file: pathFrom(base, parsed.variants.native.env_file),
        auth_key_file: pathFrom(base, parsed.variants.native.auth_key_file),
      },
    },
  } as EvalConfig;
  return { config, raw, path: absolute };
}

export function parseEnvFile(raw: string): Record<string, string> {
  const output: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) continue;
    let value = match[2] ?? "";
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[match[1] as string] = value;
  }
  return output;
}
