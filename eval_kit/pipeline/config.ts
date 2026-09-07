import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { EvalCase } from "../types.js";
import { TASK_GROUPS, taskGroup } from "../metrics/task-group.js";

const endpoint = z.object({ project: z.string(), core_url: z.string().url(), proxy_url: z.string().url() }).strict();
const schema = z.object({
  lab_root: z.string(), dataset: z.string(), asset_base: z.string(), skills: z.string(), memories: z.string(),
  results_dir: z.string(), service_id: z.string().regex(/^[\w-]+$/),
  claude_binary: z.string(), model: z.string(), per_family: z.union([z.number().int().positive(), z.literal("all")]).default(3),
  sample_seed: z.string().default(""),
  client_image: z.string().regex(/^[a-z0-9][a-z0-9_.:/-]+$/).default("tdai-eval-cli:node22-py312"),
  uv_binary: z.string(),
  timeout_ms: z.number().int().positive().default(600_000),
  processing_timeout_ms: z.number().int().positive().default(1_800_000),
  preparation_max_tokens: z.union([z.literal(4096),z.literal(8192)]).default(4096),
  preparation_thinking: z.enum(["default","disabled"]).default("default"),
  memory_cache: z.boolean().default(true),
  measurement:z.enum(["tool_calls","end_to_end"]).default("tool_calls"),
  stop_after_tools:z.record(z.string(),z.array(z.string().min(1)).min(1)).default({}),
  allow_bash: z.boolean().default(false),
  start_services: z.boolean().default(false),
  restart_proxies: z.boolean().default(false),
  reuse_preparation: z.string().min(1).optional(),
  team_member_user_ids: z.array(z.string().min(1)).default([]),
  variants: z.object({ baseline: endpoint, native: endpoint }).strict(),
}).strict();
export type PilotConfig = z.infer<typeof schema>;
export async function loadPilotConfig(path: string): Promise<PilotConfig> {
  const config = schema.parse(yaml.load(await readFile(path, "utf8")));
  const base = dirname(resolve(path));
  if (config.reuse_preparation) config.reuse_preparation = resolve(base,config.reuse_preparation);
  for (const key of ["lab_root", "dataset", "asset_base", "skills", "memories", "results_dir", "claude_binary", "uv_binary"] as const) {
    config[key] = resolve(base, config[key]);
  }
  for (const target of Object.values(config.variants)) target.project = resolve(base, target.project);
  if (config.variants.baseline.project === config.variants.native.project
    || config.variants.baseline.core_url === config.variants.native.core_url
    || config.variants.baseline.proxy_url === config.variants.native.proxy_url) throw new Error("两组必须使用独立项目与服务");
  return config;
}

// 先覆盖场景，再选同场景的下一题；固定 seed 后，文件顺序与模型表现都不影响抽样。
export function selectPilotCases(cases: EvalCase[], count: number | "all", seed = ""): EvalCase[] {
  return TASK_GROUPS.flatMap(family => {
    const rank = (id: string) => seed ? createHash("sha256").update(`${seed}:${family}:${id}`).digest("hex") : id;
    const eligible = cases.filter(c => c.suite === "main" && c.asset_path && taskGroup(c) === family);
    const groups = new Map<string, EvalCase[]>();
    for (const c of eligible.sort((a,b) => rank(a.case_id).localeCompare(rank(b.case_id)))) {
      const scenario = c.scenario_id ?? c.case_id;
      const group = groups.get(scenario) ?? []; group.push(c); groups.set(scenario, group);
    }
    const ordered = [...groups.entries()].sort(([a],[b]) => rank(a).localeCompare(rank(b))).map(([,items]) => items);
    const selected: EvalCase[] = [];
    for (let round = 0; selected.length < eligible.length; round++) {
      for (const group of ordered) { const item = group[round]; if (item) selected.push(item); }
    }
    if (count === "all") return selected;
    if (selected.length < count) throw new Error(`${family} 有素材的 Main 任务不足 ${count} 个`);
    return selected.slice(0, count);
  });
}
