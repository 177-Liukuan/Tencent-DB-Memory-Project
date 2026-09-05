import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { EvalCase } from "../types.js";

const endpoint = z.object({ project: z.string(), core_url: z.string().url(), proxy_url: z.string().url() }).strict();
const schema = z.object({
  lab_root: z.string(), dataset: z.string(), asset_base: z.string(), skills: z.string(), memories: z.string(),
  results_dir: z.string(), service_id: z.string().regex(/^[\w-]+$/),
  claude_binary: z.string(), model: z.string(), per_family: z.number().int().positive().default(3),
  client_image: z.string().regex(/^[a-z0-9][a-z0-9_.:/-]+$/).default("tdai-eval-cli:node22-py312"),
  uv_binary: z.string(),
  timeout_ms: z.number().int().positive().default(600_000),
  processing_timeout_ms: z.number().int().positive().default(1_800_000),
  preparation_max_tokens: z.union([z.literal(4096),z.literal(8192)]).default(4096),
  preparation_thinking: z.enum(["default","disabled"]).default("default"),
  measurement:z.enum(["tool_calls","end_to_end"]).default("tool_calls"),
  stop_after_tools:z.record(z.string(),z.array(z.string().min(1)).min(1)).default({}),
  allow_bash: z.boolean().default(false),
  start_services: z.boolean().default(false),
  variants: z.object({ baseline: endpoint, native: endpoint }).strict(),
}).strict();
export type PilotConfig = z.infer<typeof schema>;
export async function loadPilotConfig(path: string): Promise<PilotConfig> {
  const config = schema.parse(yaml.load(await readFile(path, "utf8")));
  const base = dirname(resolve(path));
  for (const key of ["lab_root", "dataset", "asset_base", "skills", "memories", "results_dir", "claude_binary", "uv_binary"] as const) {
    config[key] = resolve(base, config[key]);
  }
  for (const target of Object.values(config.variants)) target.project = resolve(base, target.project);
  if (config.variants.baseline.project === config.variants.native.project
    || config.variants.baseline.core_url === config.variants.native.core_url
    || config.variants.baseline.proxy_url === config.variants.native.proxy_url) throw new Error("两组必须使用独立项目与服务");
  return config;
}

// 按标签分层、场景去重；不按模型结果挑选“表现好”的样本，输入文件重新排序也不改变选择。
export function selectPilotCases(cases: EvalCase[], count: number): EvalCase[] {
  return (["memory", "skill", "none"] as const).flatMap(family => {
    const scenarios = new Set<string>();
    const selected = cases.filter(c => c.suite === "main" && c.tool_family === family && c.asset_path)
      .sort((a, b) => a.case_id.localeCompare(b.case_id)).filter(c => {
        const scenario = c.scenario_id ?? c.case_id;
        if (scenarios.has(scenario)) return false;
        scenarios.add(scenario); return true;
      }).slice(0, count);
    if (selected.length !== count) throw new Error(`${family} 有素材的独立场景不足 ${count} 个`);
    return selected;
  });
}
