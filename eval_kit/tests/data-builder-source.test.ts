import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { DataBuilderConfig } from "../data-preparation/config.js";
import { readDataBuilderSourceRevision } from "../data-preparation/source.js";

function config(root: string): DataBuilderConfig {
  return {
    configPath: join(root, "config.yaml"), datasetName: "test",
    paths: {
      baselineProject: join(root, "baseline"), nativeProject: join(root, "native"),
      skillDataset: join(root, "skills"), memoryDataset: join(root, "memories"),
      labRoot: join(root, "lab"), initialCoreData: join(root, "seed", "core"),
    },
    identity: { serviceId: "rhino-ab", userId: "usr", teamId: "team", agentId: "agent" },
    builder: { corePort: 28420, panelPort: 28124, webPort: 25173 },
    targets: { baselineCorePort: 8420, nativeCorePort: 18420 },
    processing: { timeoutMs: 1000, l2WaitMs: 100, pollIntervalMs: 100, idleConfirmations: 2 },
  };
}

async function runtimeFiles(root: string): Promise<void> {
  await mkdir(join(root, "lab", "baseline", "config"), { recursive: true });
  await mkdir(join(root, "lab", "baseline", "secrets"), { recursive: true });
  await writeFile(join(root, "lab", "baseline", "config", "core.yaml"), "llm:\n  model: deepseek-test\n");
  await writeFile(join(root, "lab", "baseline", "secrets", "core.env"), "TDAI_LLM_BASE_URL=http://model.test\nTDAI_LLM_API_KEY=do-not-copy-to-manifest\n");
}

describe("readDataBuilderSourceRevision", () => {
  test("requires matching clean MemoryCore trees and includes non-secret runtime settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-source-"));
    await runtimeFiles(root);
    const calls: string[][] = [];
    const exec = async (workingDirectory: string, args: string[]): Promise<string> => {
      calls.push([workingDirectory, ...args]);
      if (args[0] === "status") return "";
      return "same-memory-core-tree\n";
    };

    const first = await readDataBuilderSourceRevision(config(root), exec);
    await writeFile(join(root, "lab", "baseline", "secrets", "core.env"), "TDAI_LLM_BASE_URL=http://model.test\nTDAI_LLM_API_KEY=rotated-secret\n");
    const afterSecretRotation = await readDataBuilderSourceRevision(config(root), exec);
    await writeFile(join(root, "lab", "baseline", "secrets", "core.env"), "TDAI_LLM_BASE_URL=http://new-model.test\nTDAI_LLM_API_KEY=rotated-secret\n");
    const changed = await readDataBuilderSourceRevision(config(root), exec);

    expect(first).toMatch(/^same-memory-core-tree:runtime-[a-f0-9]{16}$/);
    expect(afterSecretRotation).toBe(first);
    expect(changed).not.toBe(first);
    expect(calls).toHaveLength(12);
  });

  test("rejects different MemoryCore source trees", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-source-"));
    await runtimeFiles(root);
    const currentConfig = config(root);
    const exec = async (workingDirectory: string, args: string[]): Promise<string> => {
      if (args[0] === "status") return "";
      return workingDirectory === currentConfig.paths.baselineProject ? "tree-a\n" : "tree-b\n";
    };

    await expect(readDataBuilderSourceRevision(currentConfig, exec)).rejects.toThrow("MemoryCore source trees differ");
  });
});
