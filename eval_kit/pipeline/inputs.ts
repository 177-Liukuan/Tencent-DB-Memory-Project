import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { discoverMemorySessions, type MemorySession } from "../importers/memories/importer.js";
import { discoverSkillPackages } from "../importers/skills/importer.js";
import type { PilotConfig } from "./config.js";
import type { EvalCase } from "../types.js";

// 在创建远端资源前统一读取、检查输入，避免导入到一半才发现素材缺失。
export async function loadTaskInputs(config: Pick<PilotConfig, "skills" | "memories" | "asset_base" | "reuse_preparation">, cases: EvalCase[]) {
  const frozen = config.reuse_preparation;
  // 所有任务使用同一完整库；复用旧 Memory 时也不能恢复按标签筛选过的 Skill 子集。
  const skills = await discoverSkillPackages(config.skills);
  const sessions = frozen ? [] : await discoverMemorySessions(config.memories);
  return Promise.all(cases.map(async (c, index) => {
    if (!c.asset_path) throw new Error("缺少项目素材: " + c.case_id);
    const input = frozen ? join(frozen, "inputs", "task-" + String(index + 1).padStart(2, "0")) : undefined;
    const result = {
      workspace: input ? join(input, "workspace") : resolve(config.asset_base, c.asset_path!),
      skills,
      sessions: input ? await discoverMemorySessions(join(input, "memories")) : sessions.filter(s => (c.source_memory_sessions ?? []).includes(s.sessionId)),
    };
    if (!(await stat(result.workspace)).isDirectory()) throw new Error("缺少项目素材: " + c.case_id);
    for (const name of c.expected_skills ?? []) if (!skills.some(s => s.name === name)) throw new Error("缺少 Skill: " + name);
    for (const path of c.expected_skill_files ?? []) {
      if (!(c.expected_skills ?? []).some(name => result.skills.find(s => s.name === name)?.resources.some(r => r.path === path))) {
        throw new Error(c.case_id + " Skill 资源不能导入: " + path);
      }
    }
    if (!frozen) for (const id of c.source_memory_sessions ?? []) if (!sessions.some(s => s.sessionId === id)) throw new Error("缺少 Memory: " + id);
    return result;
  }));
}

export function isolateSeedSessions(sessions: MemorySession[], experimentId: string, taskLabel: string) {
  // Core 的部分提炼游标按 sessionKey 保存；不同 Agent 也不能复用导入会话 ID。
  return sessions.map((session,index) => ({source_session_id:session.sessionId,
    session_id:`seed-${experimentId}-${taskLabel}-${index+1}`,messages:session.messages}));
}

export function resolveSessionQuery(query: string, sessions: Array<{source_session_id: string; session_id: string}>): string {
  // 使用已落盘的映射，冻结 Memory 重跑时仍指向旧种子；一次替换避免 ID 串改。
  const ids = new Map(sessions.map(s => [s.source_session_id, s.session_id]));
  if (!ids.size) return query;
  const escaped = [...ids.keys()].sort((a,b) => b.length-a.length).map(id => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(?<![A-Za-z0-9_.-])(?:${escaped.join("|")})(?![A-Za-z0-9_.-])`, "g");
  return query.replace(pattern, id => ids.get(id)!);
}
