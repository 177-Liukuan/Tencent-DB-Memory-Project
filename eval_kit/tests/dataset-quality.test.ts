import { readFile, readdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { loadDataset } from "../runner/dataset-loader.js";
import { discoverSkillPackages } from "../importers/skills/importer.js";
import type { EvalCase } from "../types.js";
import { loadTaskInputs } from "../pipeline/inputs.js";

const root = resolve(import.meta.dirname, "../dataset");
let cases: EvalCase[];
beforeAll(async () => { cases = (await loadDataset(join(root, "tasks/tool_call_eval_v1.jsonl"))).cases; });

describe("正式运行前的数据质量检查", () => {
  it("正式任务工作区不向模型暴露类别编号或评测说明", async () => {
    expect(cases.length).toBeGreaterThan(0);
    const leaks: string[] = [];
    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else if (entry.isFile() && /(?:\.md|\.json)$/.test(path)) {
          const text = await readFile(path, "utf8");
          if (/\b(?:memory|skill|none)_\d{3}_|used by the benchmark|Team-history decisions are intentionally/.test(text)) leaks.push(path);
        }
      }
    }
    for (const c of cases) await walk(resolve(root, "../", c.asset_path!));
    expect(leaks).toEqual([]);
  });

  it("Main 正例逐题声明首次选择，不强制同类别采用同一工具列表", () => {
    const invalid = cases.filter(c => c.suite === "main" && c.should_call
      && (!c.allowed_first_tools?.length || c.expected_tool_sequence?.length || c.allowed_sequences));
    expect(invalid.map(c => c.case_id)).toEqual([]);
    const available = new Set(["tdai_memory_search", "tdai_atomic_query", "tdai_conversation_search", "tdai_conversation_query", "tdai_scenario_ls", "tdai_read_scene", "skill_search", "skill_view", "skill_files_read", "skill_extract"]);
    // 允许列表由每题依据决定；这里只检查可执行性，不用统一列表代替标签审核。
    for (const c of cases) for (const tool of c.allowed_first_tools ?? []) expect(available.has(tool), c.case_id + ":" + tool).toBe(true);
  });

  it("所有正式任务的真实准备输入包含同一完整 Skill 库，不按标签筛选", async () => {
    const inputs = await loadTaskInputs({skills:join(root,"skills"),memories:join(root,"memories"),asset_base:join(root,"..")},cases);
    const packages = await discoverSkillPackages(join(root,"skills"));
    for (const input of inputs) expect(input.skills).toEqual(packages);
  });

  it("所有预期 Skill 资源都能由实际导入器发现，不只是在磁盘存在", async () => {
    const skills = await discoverSkillPackages(join(root, "skills"));
    const missing: string[] = [];
    for (const c of cases) for (const path of c.expected_skill_files ?? []) {
      if (!(c.expected_skills ?? []).some(name => skills.find(s => s.name === name)?.resources.some(r => r.path === path))) missing.push(c.case_id + ":" + path);
    }
    expect(missing).toEqual([]);
  });

  it("Memory 目标引用仍准确，目标分布到历史后部，没有编号填充", async () => {
    const sessions = new Map<string, {role:string;content:string;timestamp:string}[]>();
    for (const file of await readdir(join(root, "memories"))) {
      if (!file.endsWith(".json")) continue;
      const session = JSON.parse(await readFile(join(root, "memories", file), "utf8"));
      sessions.set(session.session_id, session.messages);
    }
    const filler: string[] = [];
    for (const [id, messages] of sessions) if (messages.some(m => /的辅助配置 .*cfg-/.test(m.content))) filler.push(id);
    expect(filler).toEqual([]);
    for (const c of cases) for (const ref of c.target_memory_refs ?? []) {
      const messages = sessions.get(ref.session_id)!;
      expect(messages[ref.user_message_index]?.role).toBe("user");
      expect(messages[ref.assistant_message_index]?.role).toBe("assistant");
      expect(messages[ref.user_message_index]!.content).toContain(messages[ref.assistant_message_index]!.content.replace(/^已记录：/, ""));
    }
    expect(cases.flatMap(c => c.target_memory_refs ?? []).some(r => r.user_message_index >= 24)).toBe(true);
  });

  it("合成的复盘消息不能早于正文已发生的事故或评审日期", async () => {
    const invalid = new Set<string>();
    for (const file of await readdir(join(root,"memories"))) {
      if (!file.endsWith(".json")) continue;
      const session = JSON.parse(await readFile(join(root,"memories",file),"utf8"));
      let previous = "";
      for (const message of session.messages as {content:string;timestamp:string}[]) {
        expect(message.timestamp > previous).toBe(true);
        previous = message.timestamp;
        // 只检查这些对话里已经复盘的事件，不将一般未来计划误判为时间矛盾。
        for (const match of message.content.matchAll(/(2026-\d{2}-\d{2})[^。；\n]{0,24}(?:复盘|评审)/g)) {
          if (match[1]! > message.timestamp.slice(0,10)) invalid.add(session.session_id);
        }
      }
    }
    expect([...invalid]).toEqual([]);
  });
});
