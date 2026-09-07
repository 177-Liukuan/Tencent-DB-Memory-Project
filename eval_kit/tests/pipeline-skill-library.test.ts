import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { loadTaskInputs } from "../pipeline/inputs.js";
import type { EvalCase } from "../types.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "eval-skill-library-"));
  roots.push(root);
  const config = { skills: join(root, "skills"), memories: join(root, "memories"), asset_base: root };
  for (const name of ["gamma", "alpha", "beta"]) {
    const dir = join(config.skills, name, "references");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "guide.md"), name + " resource");
    await writeFile(join(dir, "../SKILL.md"), `---\nname: ${name}\ndescription: ${name} workflow\n---\n${name} body\n`);
  }
  await mkdir(config.memories);
  await writeFile(join(config.memories, "sessions.json"), JSON.stringify([
    { session_id: "source", messages: [{ role: "user", content: "original memory" }] },
    { session_id: "other", messages: [{ role: "user", content: "not requested" }] },
  ]));
  await mkdir(join(root, "workspace"));
  const cases: EvalCase[] = (["memory", "skill", "none"] as const).map(family => ({
    schema_version: 1, case_id: family + "_task", suite: "main", query: "task", tool_family: family,
    should_call: family !== "none", expected_tools: family === "none" ? [] : ["skill_view"],
    asset_path: "workspace", source_memory_sessions: ["source"], candidate_skills: ["beta"],
  }));
  return { root, config, cases };
}

it("三类任务都准备完整 Skill 库，候选列表不再缩小范围，Memory 仍按任务隔离", async () => {
  const { config, cases } = await fixture();
  cases[1]!.candidate_skills = [];
  delete cases[2]!.candidate_skills;
  const inputs = await loadTaskInputs(config, cases);
  for (const input of inputs) {
    expect(input.skills.map(s => s.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(input.skills[0]!.content).toContain("alpha body");
    expect(input.skills[0]!.resources).toEqual([{ path: "references/guide.md", content: "alpha resource", encoding: "utf-8" }]);
    expect(input.sessions.map(s => s.sessionId)).toEqual(["source"]);
  }
});

it("复用旧准备只读取冻结 Memory 和工作区，Skill 改用当前完整库", async () => {
  const { root, config, cases } = await fixture();
  const frozen = join(root, "frozen");
  const input = join(frozen, "inputs/task-01");
  await mkdir(join(input, "workspace"), { recursive: true });
  await mkdir(join(input, "memories"));
  await writeFile(join(input, "memories/sessions.json"), JSON.stringify({ session_id: "frozen-source", messages: [{ role: "user", content: "frozen memory" }] }));
  await mkdir(join(input, "skills/alpha"), { recursive: true });
  await writeFile(join(input, "skills/alpha/SKILL.md"), "---\nname: alpha\ndescription: old\n---\nold body");
  const [result] = await loadTaskInputs({ ...config, reuse_preparation: frozen }, [cases[0]!]);
  expect(result!.skills.map(s => s.name)).toEqual(["alpha", "beta", "gamma"]);
  expect(result!.skills[0]!.content).toContain("alpha body");
  expect(result!.workspace).toBe(join(input, "workspace"));
  expect(result!.sessions[0]!.messages[0]!.content).toBe("frozen memory");
});

it("过时的候选名字不影响导入，但预期 Skill 不存在必须在导入前报错", async () => {
  const { config, cases } = await fixture();
  cases[0]!.candidate_skills = ["removed-candidate"];
  const [result] = await loadTaskInputs(config, [cases[0]!]);
  expect(result!.skills).toHaveLength(3);
  cases[0]!.expected_skills = ["missing-target"];
  await expect(loadTaskInputs(config, [cases[0]!])).rejects.toThrow("缺少 Skill: missing-target");
});

it("完整库模式仍在导入前拒绝缺失的预期资源和 Memory", async () => {
  const { config, cases } = await fixture();
  cases[0]!.expected_skills = ["alpha"];
  cases[0]!.expected_skill_files = ["references/missing.md"];
  await expect(loadTaskInputs(config, [cases[0]!])).rejects.toThrow("Skill 资源不能导入");
  cases[0]!.expected_skill_files = [];
  cases[0]!.source_memory_sessions = ["missing-session"];
  await expect(loadTaskInputs(config, [cases[0]!])).rejects.toThrow("缺少 Memory");
});
