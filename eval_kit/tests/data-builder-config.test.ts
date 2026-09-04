import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  inspectDataBuilderInputs,
  loadDataBuilderConfig,
} from "../data-preparation/config.js";

async function writeConfig(root: string, overrides = ""): Promise<string> {
  const configPath = join(root, "config.yaml");
  await writeFile(configPath, `
version: 1
datasetName: test-dataset
paths:
  baselineProject: ./baseline
  nativeProject: ./native
  skillDataset: ./skills
  memoryDataset: ./memories
  labRoot: ./lab
  initialCoreData: ./seed/core
identity:
  serviceId: rhino-ab
  userId: usr-test
  teamId: team-test
  agentId: agt-test
${overrides}`);
  return configPath;
}

async function createValidInputs(root: string): Promise<void> {
  for (const project of ["baseline", "native"]) {
    await mkdir(join(root, project, "MemoryCore"), { recursive: true });
    await mkdir(join(root, project, "MemoryPanel", "web"), { recursive: true });
    await writeFile(join(root, project, "MemoryCore", "package.json"), JSON.stringify({ version: "2.0.0" }));
    await writeFile(join(root, project, "MemoryPanel", "package.json"), JSON.stringify({ version: "1.0.0" }));
    await writeFile(join(root, project, "MemoryPanel", "web", "package.json"), JSON.stringify({ version: "1.0.0" }));
  }
  await mkdir(join(root, "skills", "example"), { recursive: true });
  await writeFile(
    join(root, "skills", "example", "SKILL.md"),
    "---\nname: example-skill\ndescription: Example\n---\n\n# Example\n",
  );
  await mkdir(join(root, "memories"), { recursive: true });
  await writeFile(join(root, "memories", "example.json"), JSON.stringify({
    session_id: "example-session",
    messages: [
      { role: "user", content: "Remember pnpm." },
      { role: "assistant", content: "Understood." },
    ],
  }));
  await mkdir(join(root, "seed", "core"), { recursive: true });
  await writeFile(join(root, "seed", "core", "seed.txt"), "seed");
  await mkdir(join(root, "lab", "baseline", "secrets"), { recursive: true });
  await writeFile(join(root, "lab", "baseline", "secrets", "core.env"), "TDAI_GATEWAY_API_KEY=test-key\n");
  for (const name of ["core-gateway.key", "admin-user.key", "memory-user.key"]) {
    await writeFile(join(root, "lab", "baseline", "secrets", name), "test-key\n");
  }
}

describe("loadDataBuilderConfig", () => {
  test("resolves paths from the config directory and applies operational defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-config-"));
    const config = await loadDataBuilderConfig(await writeConfig(root));

    expect(config.paths).toEqual({
      baselineProject: join(root, "baseline"),
      nativeProject: join(root, "native"),
      skillDataset: join(root, "skills"),
      memoryDataset: join(root, "memories"),
      labRoot: join(root, "lab"),
      initialCoreData: join(root, "seed", "core"),
    });
    expect(config.builder).toEqual({ corePort: 28420, panelPort: 28124, webPort: 25173 });
    expect(config.targets).toEqual({ baselineCorePort: 8420, nativeCorePort: 18420 });
    expect(config.processing).toEqual({
      timeoutMs: 7_200_000,
      l2WaitMs: 95_000,
      pollIntervalMs: 1_000,
      idleConfirmations: 3,
    });
  });

  test("rejects duplicate builder ports", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-config-"));
    const path = await writeConfig(root, "builder:\n  corePort: 28420\n  panelPort: 28420\n  webPort: 25173\n");

    await expect(loadDataBuilderConfig(path)).rejects.toThrow("builder and target Core ports must all be different");
  });

  test("rejects broad or overlapping runtime paths before any data can be replaced", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-config-"));
    const broad = await writeConfig(root);
    const broadYaml = await readFile(broad, "utf8");
    await writeFile(broad, broadYaml.replace("labRoot: ./lab", "labRoot: /"));
    await expect(loadDataBuilderConfig(broad)).rejects.toThrow("labRoot is too broad");

    const overlapping = await writeConfig(root);
    const overlappingYaml = await readFile(overlapping, "utf8");
    await writeFile(overlapping, overlappingYaml.replace("nativeProject: ./native", "nativeProject: ./baseline"));
    await expect(loadDataBuilderConfig(overlapping)).rejects.toThrow("must be different directories");
  });
});

describe("inspectDataBuilderInputs", () => {
  test("validates both source projects and discovers the prepared datasets", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-inspect-"));
    await createValidInputs(root);
    const config = await loadDataBuilderConfig(await writeConfig(root));

    const result = await inspectDataBuilderInputs(config);

    expect(result).toEqual({
      memoryCoreVersion: "2.0.0",
      skillNames: ["example-skill"],
      sessions: [{ sessionId: "example-session", messageCount: 2 }],
      totalMessages: 2,
    });
  });

  test("fails before execution when a configured project is incomplete", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-inspect-"));
    await createValidInputs(root);
    await writeFile(join(root, "native", "MemoryCore", "package.json"), JSON.stringify({ version: "2.1.0" }));
    const config = await loadDataBuilderConfig(await writeConfig(root));

    await expect(inspectDataBuilderInputs(config)).rejects.toThrow(
      "Baseline and Native MemoryCore versions differ",
    );
  });
});
