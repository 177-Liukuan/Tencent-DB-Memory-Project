import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { parseSkillImportCommand } from "../importers/skills/command.js";

async function labFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skill-import-command-"));
  for (const variant of ["native", "baseline"] as const) {
    await mkdir(join(root, variant, "secrets"), { recursive: true });
    await writeFile(join(root, variant, "secrets", "core-gateway.key"), `${variant}-key\n`, { mode: 0o600 });
  }
  return root;
}

describe("parseSkillImportCommand", () => {
  test("resolves the default lab root beside eval_kit", async () => {
    const command = await import("../importers/skills/command.js");
    const defaultLabRoot = (command as typeof command & {
      defaultSkillImportLabRoot?: () => string;
    }).defaultSkillImportLabRoot;

    expect(defaultLabRoot).toBeTypeOf("function");
    expect(defaultLabRoot?.()).toBe(resolve(process.cwd(), "../tencentdb-memory-lab"));
  });

  test("builds both targets from the lab key files without putting secrets in CLI arguments", async () => {
    const labRoot = await labFixture();

    const parsed = await parseSkillImportCommand([
      "--variant", "both",
      "--directory", "/tmp/skills",
      "--lab-root", labRoot,
      "--user-id", "usr-1",
      "--team-id", "team-1",
      "--agent-id", "agt-1",
      "--service-id", "rhino-ab",
      "--on-conflict", "skip",
      "--dry-run",
    ], {});

    expect(parsed.targets.map((target) => ({ label: target.label, baseUrl: target.baseUrl, apiKey: target.apiKey }))).toEqual([
      { label: "baseline", baseUrl: "http://127.0.0.1:8420", apiKey: "baseline-key" },
      { label: "native", baseUrl: "http://127.0.0.1:18420", apiKey: "native-key" },
    ]);
    expect(parsed.options).toEqual({ directory: "/tmp/skills", onConflict: "skip", dryRun: true });
  });

  test("allows environment variables to override URL and API key", async () => {
    const parsed = await parseSkillImportCommand([
      "--variant=native",
      "--directory=/tmp/skills",
      "--user-id=usr-1",
      "--team-id=team-1",
      "--agent-id=agt-1",
    ], {
      TDAI_NATIVE_CORE_URL: "https://native.example.test/",
      TDAI_NATIVE_SKILL_API_KEY: "env-key",
    });

    expect(parsed.targets).toMatchObject([
      { label: "native", baseUrl: "https://native.example.test", apiKey: "env-key", serviceId: "rhino-ab" },
    ]);
  });

  test("rejects an unsupported conflict mode before reading credentials", async () => {
    await expect(parseSkillImportCommand([
      "--variant", "native",
      "--directory", "/tmp/skills",
      "--user-id", "usr-1",
      "--team-id", "team-1",
      "--agent-id", "agt-1",
      "--on-conflict", "overwrite",
    ], {})).rejects.toThrow("--on-conflict must be error, skip, or update");
  });
});
