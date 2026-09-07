import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { HTTPException } from "hono/http-exception";
import { loadDataset } from "../runner/dataset-loader.js";
import { taskGroup } from "../metrics/task-group.js";

function distribution(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** 只读当前任务文件，沿用 Runner 的校验规则；标签统计不代表模型已经调用或标签已经审核。 */
export async function readDatasetOverview(path: string) {
  let loaded;
  try { loaded = await loadDataset(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HTTPException(404, { message: "未找到任务数据集，请检查启动时的 --dataset 路径。" });
    if (["EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    throw new HTTPException(422, { message: "任务文件为空或格式不正确，请检查 JSONL、重复 case_id 和工具标签规则。" });
  }
  const items = loaded.cases.map(item => ({ ...item, task_group: taskGroup(item) }));
  const unique = (values: string[]) => new Set(values.filter(Boolean)).size;
  return {
    source: { name: basename(path), updated_at: (await stat(path)).mtime.toISOString() },
    summary: {
      tasks: items.length,
      positive: items.filter(item => item.should_call).length,
      negative: items.filter(item => !item.should_call).length,
      scenarios: unique(items.flatMap(item => item.scenario_id ? [item.scenario_id] : [])),
      assets: unique(items.flatMap(item => item.asset_path ? [item.asset_path] : [])),
      memory_sessions: unique(items.flatMap(item => item.source_memory_sessions ?? [])),
      skills: unique(items.flatMap(item => [...item.candidate_skills ?? [], ...item.expected_skills ?? []])),
    },
    distributions: {
      families: distribution(items.map(item => item.task_group)),
      difficulties: distribution(items.map(item => item.difficulty ?? "unknown")),
      scenarios: distribution(items.map(item => item.scenario_id ?? "unknown")),
      // 同一案例需要两次 skill_view，仍只计一条涉及该工具的任务，不当作两次实测调用。
      tools: distribution(items.flatMap(item => [...new Set(item.expected_tools)])),
    },
    items,
  };
}
