import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { discoverMemorySessions } from "../importers/memories/importer.js";
import { discoverSkillPackages } from "../importers/skills/importer.js";

const evalRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const datasetRoot = resolve(evalRoot, "dataset");
const templatesRoot = resolve(datasetRoot, "template4AI");

describe("dataset generation templates", () => {
  test("keeps formal evaluation data under one dataset root", () => {
    expect(existsSync(datasetRoot)).toBe(true);
    expect(existsSync(resolve(evalRoot, "datasets"))).toBe(false);
  });

  test("keeps browser-use and docling as formal evaluation Skills", async () => {
    const skills = await discoverSkillPackages(resolve(datasetRoot, "skills"));
    const names = skills.map((skill) => skill.name);

    expect(names).toEqual(expect.arrayContaining([
      "browser-use",
      "docling-document-intelligence",
    ]));
    expect(new Set(names).size).toBe(names.length);
  });

  test("provides three directly importable Skill examples with unique names", async () => {
    const skills = await discoverSkillPackages(resolve(templatesRoot, "skills", "examples"));

    expect(skills).toHaveLength(3);
    expect(new Set(skills.map((skill) => skill.name)).size).toBe(3);
    expect(skills.every((skill) => skill.content.startsWith("---\nname:"))).toBe(true);
  });

  test("keeps the Skill template outside the importable examples directory", async () => {
    const template = await readFile(resolve(templatesRoot, "skills", "SKILL.template.md"), "utf8");

    expect(template).toContain("{{skill-name}}");
    expect(template).toContain("## 适用场景");
    expect(template).toContain("## 检查方法");
  });

  test("provides 50, 100, and 200-round L0 examples", async () => {
    const sessions = await discoverMemorySessions(resolve(templatesRoot, "memories", "examples"));
    const rounds = sessions.map((session) => session.messages.length / 2).sort((left, right) => left - right);

    expect(rounds).toEqual([50, 100, 200]);
    for (const session of sessions) {
      expect(session.messages.length % 2).toBe(0);
      session.messages.forEach((message, index) => {
        expect(message.role).toBe(index % 2 === 0 ? "user" : "assistant");
        expect(message.timestamp).toBeTruthy();
      });
    }
  });

  test("keeps the Memory template parseable after placeholder replacement", async () => {
    const raw = await readFile(resolve(templatesRoot, "memories", "memory-session.template.json"), "utf8");
    const rendered = raw
      .replace("{{session-id}}", "generated-session")
      .replace("{{user-message}}", "用户提供的事实或问题")
      .replace("{{assistant-message}}", "助手的确认、结论或处理结果")
      .replace("{{user-timestamp}}", "2026-01-01T00:00:00.000Z")
      .replace("{{assistant-timestamp}}", "2026-01-01T00:01:00.000Z");

    expect(() => JSON.parse(rendered)).not.toThrow();
  });
});
