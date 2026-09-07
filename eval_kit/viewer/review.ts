import { readFile, mkdir, open, rename, unlink, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { HTTPException } from "hono/http-exception";
import { parseDataset } from "../runner/dataset-loader.js";
import type { EvalCase } from "../types.js";
import { taskGroup } from "../metrics/task-group.js";

export interface ReviewTool { name: string; description: string; summary: string; kind: "tool" | "skill"; enabled: boolean; group: string }
export async function readReviewCatalog(path: string): Promise<ReviewTool[]> {
  const text = await readFile(path, "utf8");
  const tools: ReviewTool[] = [];
  let group = "";
  // 只解析文档中的工具表格；具体 Skill 与未开放能力不能成为可选首个工具。
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("## ")) group = line.slice(3).trim();
    if (!line.startsWith("| `")) continue;
    const cells = line.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim().replace(/\\\|/g, "|"));
    const name = cells[0]?.match(/^`([^`]+)`$/)?.[1];
    if (!name || cells.length !== 3 || !cells[1] || !cells[2] || tools.some(t => t.name === name)) {
      throw new HTTPException(422, { message: "工具说明表格格式错误或名称重复，请检查可供选择的工具.md。" });
    }
    tools.push({ name, description: cells[1], summary: cells[2], group,
      kind: group.includes("数据集") ? "skill" : "tool", enabled: !group.includes("未开放") });
  }
  if (!tools.length) throw new HTTPException(422, { message: "工具说明文档中没有可读取的工具表格。" });
  return tools;
}

function checked(raw: string) {
  try { return parseDataset(raw); }
  catch (error) { throw new HTTPException(422, { message: `任务校验失败：${error instanceof Error ? error.message : String(error)}` }); }
}
async function snapshot(path: string) {
  const raw = await readFile(path, "utf8");
  const loaded = checked(raw);
  // 保留原始字段，不把评分器派生的 expected_tools 反写进人工数据。
  const items = raw.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line) as EvalCase);
  return { raw, items, revision: loaded.sha256 };
}
export async function readReview(path: string, catalogPath: string) {
  const [data, catalog] = await Promise.all([snapshot(path), readReviewCatalog(catalogPath)]);
  const normalized = checked(data.raw).cases;
  return { source: basename(path), revision: data.revision, items: data.items, catalog,
    task_groups: Object.fromEntries(normalized.map(item => [item.case_id, taskGroup(item)])) };
}
export function parseImport(content: string): EvalCase[] {
  try {
    let values: unknown;
    try { values = JSON.parse(content); }
    catch { values = content.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error(`第 ${index + 1} 行不是有效 JSON`); }
    }); }
    const items = Array.isArray(values) ? values : [values];
    checked(items.map(value => JSON.stringify(value)).join("\n"));
    return items as EvalCase[];
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(422, { message: `导入格式错误：${error instanceof Error ? error.message : String(error)}` });
  }
}
function validateChoices(items: EvalCase[], catalog: ReviewTool[]) {
  const available = new Set(catalog.filter(t => t.kind === "tool" && t.enabled).map(t => t.name));
  for (const item of items) {
    const tools = [...item.expected_tools ?? [], ...item.allowed_first_tools ?? [], ...item.expected_tool_sequence ?? [],
      ...item.allowed_sequences?.flat() ?? [], ...(item.expected_tool ? [item.expected_tool] : [])];
    const invalid = tools.find(name => !available.has(name));
    if (invalid) throw new HTTPException(422, { message: `${item.case_id}：${invalid} 不是文档中已开放的 Proxy Tool。` });
    if (!item.query.trim()) throw new HTTPException(422, { message: `${item.case_id}：用户输入不能为空。` });
    if (item.tool_family && ((item.tool_family === "none") === item.should_call)) {
      throw new HTTPException(422, { message: `${item.case_id}：None 类别与是否调用工具不一致。` });
    }
  }
}
export async function changeReview(path: string, catalogPath: string, input: {
  revision: string; items: EvalCase[]; replaceExisting: boolean; preview: boolean; editingId?: string;
}) {
  // 锁只覆盖一次本地文件写入，避免两个 Viewer 实例同时覆盖数据；不引入数据库。
  const lockPath = path + ".review.lock";
  let lock;
  try { lock = await open(lockPath, "wx", 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new HTTPException(409, { message: "另一次保存正在进行，请稍后重试。" });
    throw error;
  }
  let temporary: string | undefined;
  try {
    const current = await snapshot(path);
    if (input.revision !== current.revision) throw new HTTPException(409, { message: "数据已被其他页面修改。请复制未保存内容，刷新后重新核对，不会覆盖新版本。" });
    checked(input.items.map(t => JSON.stringify(t)).join("\n"));
    validateChoices(input.items, await readReviewCatalog(catalogPath));
    if (input.editingId && (input.items.length !== 1 || input.items[0]?.case_id !== input.editingId)) {
      throw new HTTPException(422, { message: "编辑现有任务时不能更改任务 ID。" });
    }
    const index = new Map(current.items.map(t => [t.case_id, t]));
    if (input.editingId && !index.has(input.editingId)) throw new HTTPException(404, { message: "任务不存在，请刷新列表。" });
    const conflicts = input.items.filter(t => index.has(t.case_id)).map(t => t.case_id);
    if (conflicts.length && !input.replaceExisting) throw new HTTPException(409, { message: `存在重复任务 ID：${conflicts.join("、")}。如需更新，请明确勾选替换。` });
    for (const item of input.items) index.set(item.case_id, item);
    const next = [...index.values()].map(t => JSON.stringify(t)).join("\n") + "\n";
    const revision = checked(next).sha256;
    const counts = { added: input.items.length - conflicts.length, updated: conflicts.length, total: index.size };
    if (input.preview) return { ...counts, revision: current.revision, preview: true };
    const stamp = new Date().toISOString().replace(/[:.]/g, "-") + "-" + randomUUID();
    const backupDirectory = join(dirname(path), ".review-backups");
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
    const backupName = basename(path) + "." + stamp + ".bak";
    const backup = await open(join(backupDirectory, backupName), "wx", 0o600);
    try { await backup.writeFile(current.raw); await backup.sync(); } finally { await backup.close(); }
    temporary = path + "." + stamp + ".tmp";
    const file = await open(temporary, "wx", (await stat(path)).mode & 0o777);
    try { await file.writeFile(next); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    return { ...counts, revision, backup: ".review-backups/" + backupName, preview: false };
  } finally {
    try {
      if (temporary) await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    } finally { await lock.close(); await unlink(lockPath); }
  }
}
