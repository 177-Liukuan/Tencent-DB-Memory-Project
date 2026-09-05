import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { cp, readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export type SeedEndpoint = {
  dbPath: string; profilesRoot: string; project?: string;
  identity: { team_id: string; agent_id: string; user_id: string };
};
type Row = Record<string, SQLInputValue>;
const tables = ["l0_conversations", "l1_records", "l0_fts", "l1_fts", "l0_vec", "l1_vec"];
function open(endpoint: SeedEndpoint, readOnly: boolean): DatabaseSync {
  const db = new DatabaseSync(endpoint.dbPath, { readOnly, allowExtension: true });
  db.exec("PRAGMA busy_timeout=10000");
  if (db.prepare("SELECT name FROM sqlite_master WHERE name='l1_vec'").get()) {
    if (!endpoint.project) { db.close(); throw new Error("向量索引需要对应项目中的 sqlite-vec"); }
    createRequire(join(endpoint.project, "MemoryCore/package.json"))("sqlite-vec").load(db);
  }
  return db;
}
function profilePath(endpoint: SeedEndpoint): string {
  return join(endpoint.profilesRoot, encodeURIComponent(`team:${endpoint.identity.team_id}|agent:${endpoint.identity.agent_id}`));
}
async function profileFiles(path: string, root = path): Promise<Array<{path:string; content:string}>> {
  const info = await stat(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!info) return [];
  const output: Array<{path:string;content:string}> = [];
  for (const entry of (await readdir(path, {withFileTypes:true})).sort((a,b) => a.name.localeCompare(b.name))) {
    const file = join(path, entry.name);
    if (entry.isSymbolicLink()) throw new Error("画像目录不允许符号链接: " + file);
    if (entry.isDirectory()) output.push(...await profileFiles(file, root));
    else if (entry.isFile()) output.push({path:relative(root,file),content:(await readFile(file)).toString("base64")});
  }
  return output;
}
function rows(db: DatabaseSync, endpoint: SeedEndpoint): Record<string, Row[]> {
  const result: Record<string, Row[]> = {};
  const {team_id, user_id, agent_id} = endpoint.identity;
  for (const table of tables) {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE name=?").get(table)) continue;
    if (table.endsWith("_vec")) {
      const parent = table === "l0_vec" ? "l0_conversations" : "l1_records";
      result[table] = db.prepare(`SELECT v.* FROM ${table} v JOIN ${parent} p ON v.record_id=p.record_id
        WHERE p.team_id=? AND p.user_id=? AND p.agent_id=? ORDER BY v.record_id`).all(team_id,user_id,agent_id) as Row[];
    } else result[table] = db.prepare(`SELECT * FROM ${table} WHERE team_id=? AND user_id=? AND agent_id=? ORDER BY record_id`)
      .all(team_id,user_id,agent_id) as Row[];
  }
  for (const required of tables.slice(0,4)) if (!result[required]) throw new Error("缺少本地记忆表: " + required);
  return result;
}
function digestRows(data: Record<string, Row[]>, files: Array<{path:string;content:string}>): string {
  // 只忽略新建身份本身；正文、ID、索引、时间、向量和画像全部纳入配对核对。
  const normalized = Object.fromEntries(Object.entries(data).map(([name, records]) => [name, records.map(row =>
    Object.fromEntries(Object.entries(row).filter(([key]) => !["team_id", "user_id", "agent_id"].includes(key))))]));
  return createHash("sha256").update(JSON.stringify({tables:normalized,files})).digest("hex");
}
export async function inspectMemorySeed(endpoint: SeedEndpoint) {
  const db = open(endpoint, true);
  try {
    const data = rows(db, endpoint); const files = await profileFiles(profilePath(endpoint));
    return { digest: digestRows(data,files), counts:Object.fromEntries(Object.entries(data).map(([k,v]) => [k,v.length])),
      profileFiles: files.map(f=>f.path), vectorsEnabled: "l1_vec" in data };
  } finally { db.close(); }
}

// 只向刚创建的 Agent 追加种子；不替换 Core 数据目录，也不改动原有人工会话。
export async function copyMemorySeed(source: SeedEndpoint, target: SeedEndpoint) {
  if (source.dbPath === target.dbPath) throw new Error("种子复制只支持独立数据库");
  const sourceDb = open(source, true); const targetDb = open(target, false);
  try {
    sourceDb.exec("BEGIN");
    const data = rows(sourceDb, source); const existing = rows(targetDb, target);
    const files = await profileFiles(profilePath(source));
    if (Object.values(existing).some(r=>r.length) || (await profileFiles(profilePath(target))).length) throw new Error("目标 Agent 非空，不允许复用");
    if (Object.keys(data).join() !== Object.keys(existing).join()) throw new Error("两组记忆存储模式不一致");
    targetDb.exec("BEGIN IMMEDIATE");
    try {
      for (const [table, records] of Object.entries(data)) {
        for (const row of records) {
          const rewritten = {...row};
          for (const [key,value] of Object.entries(target.identity)) if (key in row) rewritten[key] = value;
          const columns = Object.keys(rewritten);
          targetDb.prepare(`INSERT INTO ${table} (${columns.map(c=>'"'+c+'"').join(",")}) VALUES (${columns.map(()=>"?").join(",")})`)
            .run(...Object.values(rewritten));
        }
      }
      targetDb.exec("COMMIT");
    } catch (error) { targetDb.exec("ROLLBACK"); throw error; }
    sourceDb.exec("COMMIT");
    if (files.length) await cp(profilePath(source), profilePath(target), {recursive:true,errorOnExist:true,force:false});
    const copied = await inspectMemorySeed(target);
    if (copied.digest !== digestRows(data,files)) throw new Error("种子内容核对失败，不开始评测");
    return copied;
  } finally { sourceDb.close(); targetDb.close(); }
}
