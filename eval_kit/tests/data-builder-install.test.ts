import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { DataBuilderConfig } from "../data-preparation/config.js";
import { installReleaseToTargets } from "../data-preparation/install.js";
import type { DataBuilderRelease } from "../data-preparation/release.js";

function config(root: string): DataBuilderConfig {
  return {
    configPath: join(root, "config.yaml"),
    datasetName: "eval-v1",
    paths: {
      baselineProject: join(root, "baseline-project"),
      nativeProject: join(root, "native-project"),
      skillDataset: join(root, "skills"),
      memoryDataset: join(root, "memories"),
      labRoot: join(root, "lab"),
      initialCoreData: join(root, "seed", "core"),
    },
    identity: { serviceId: "rhino-ab", userId: "usr-1", teamId: "team-1", agentId: "agt-1" },
    builder: { corePort: 28420, panelPort: 28124, webPort: 25173 },
    targets: { baselineCorePort: 8420, nativeCorePort: 18420 },
    processing: { timeoutMs: 100, l2WaitMs: 20, pollIntervalMs: 10, idleConfirmations: 2 },
  };
}

async function fixture(root: string): Promise<{ config: DataBuilderConfig; release: DataBuilderRelease }> {
  const currentConfig = config(root);
  const releaseDirectory = join(root, "release");
  const coreDirectory = join(releaseDirectory, "core");
  await mkdir(coreDirectory, { recursive: true });
  await writeFile(join(coreDirectory, "dataset.txt"), "same prepared dataset");
  for (const variant of ["baseline", "native"]) {
    const target = join(currentConfig.paths.labRoot, variant, "data", "core");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "previous.txt"), `${variant} previous data`);
  }
  const manifest = {
    schemaVersion: 1 as const,
    releaseId: "eval-v1-123456789abc",
    datasetName: "eval-v1",
    inputDigest: "123456789abcdef",
    sourceRevision: "commit-one",
    memoryCoreVersion: "2.0.0",
    createdAt: "2026-09-04T12:00:00.000Z",
    identity: currentConfig.identity,
    skillNames: ["example-skill"],
    sessions: [{ sessionId: "session-1", messageCount: 2 }],
    totalMessages: 2,
    files: [],
  };
  return {
    config: currentConfig,
    release: {
      releaseId: manifest.releaseId,
      directory: releaseDirectory,
      coreDirectory,
      manifestPath: join(releaseDirectory, "manifest.json"),
      manifest,
    },
  };
}

describe("installReleaseToTargets", () => {
  test("installs the same frozen data in both environments and retains both previous copies", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-install-"));
    const input = await fixture(root);
    const commands: string[][] = [];

    const result = await installReleaseToTargets({
      ...input,
      timestamp: "20260904T120000Z",
      run: async (command, args) => { commands.push([command, ...args]); },
      adjustNativeReferences: async () => undefined,
    });

    for (const variant of ["baseline", "native"]) {
      expect(await readFile(join(input.config.paths.labRoot, variant, "data", "core", "dataset.txt"), "utf8"))
        .toBe("same prepared dataset");
      expect(await readFile(join(result.backupDirectory, variant, "core", "previous.txt"), "utf8"))
        .toBe(`${variant} previous data`);
      const receipt = JSON.parse(await readFile(join(input.config.paths.labRoot, variant, "data-builder-release.json"), "utf8")) as Record<string, unknown>;
      expect(receipt.releaseId).toBe(input.release.releaseId);
    }
    expect(commands[0]).toEqual([
      "systemctl", "--user", "stop",
      "tdam-baseline-proxy.service", "tdam-baseline-web.service", "tdam-baseline-panel.service", "tdam-baseline-core.service",
      "tdam-native-proxy.service", "tdam-native-web.service", "tdam-native-panel.service", "tdam-native-core.service",
    ]);
    expect(commands.at(-1)).toEqual([
      "systemctl", "--user", "start",
      "tdam-baseline-core.service", "tdam-native-core.service",
      "tdam-baseline-panel.service", "tdam-baseline-web.service", "tdam-baseline-proxy.service",
      "tdam-native-panel.service", "tdam-native-web.service", "tdam-native-proxy.service",
    ]);
  });

  test("restores both previous copies when native adaptation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-rollback-"));
    const input = await fixture(root);
    const commands: string[][] = [];

    await expect(installReleaseToTargets({
      ...input,
      timestamp: "20260904T130000Z",
      run: async (command, args) => { commands.push([command, ...args]); },
      adjustNativeReferences: async () => { throw new Error("simulated native adaptation failure"); },
    })).rejects.toThrow(/rolled back.*simulated native adaptation failure/);

    for (const variant of ["baseline", "native"]) {
      expect(await readFile(join(input.config.paths.labRoot, variant, "data", "core", "previous.txt"), "utf8"))
        .toBe(`${variant} previous data`);
      expect(await readFile(join(input.config.paths.labRoot, "run", "data-builder-backups", "20260904T130000Z", "failed-install", variant, "core", "dataset.txt"), "utf8"))
        .toBe("same prepared dataset");
    }
    expect(commands.at(-1)?.slice(0, 3)).toEqual(["systemctl", "--user", "start"]);
  });

  test("restores both previous copies when post-start verification fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-verify-rollback-"));
    const input = await fixture(root);
    const commands: string[][] = [];

    await expect(installReleaseToTargets({
      ...input,
      timestamp: "20260904T140000123Z",
      run: async (command, args) => { commands.push([command, ...args]); },
      adjustNativeReferences: async () => undefined,
      verify: async () => { throw new Error("simulated verification failure"); },
    })).rejects.toThrow(/rolled back.*simulated verification failure/);

    for (const variant of ["baseline", "native"]) {
      expect(await readFile(join(input.config.paths.labRoot, variant, "data", "core", "previous.txt"), "utf8"))
        .toBe(`${variant} previous data`);
    }
    expect(commands.filter((command) => command[2] === "start")).toHaveLength(2);
    expect(commands.filter((command) => command[2] === "stop")).toHaveLength(2);
  });
});
