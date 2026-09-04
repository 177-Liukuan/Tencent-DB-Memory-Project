import { join } from "node:path";

import { describe, expect, test, vi } from "vitest";

import type { DataBuilderConfig, InputInspection } from "../data-preparation/config.js";
import type { DataBuilderRelease } from "../data-preparation/release.js";
import type { BuilderLayout } from "../data-preparation/runtime.js";
import { prepareDataBuilder, type PrepareDataBuilderDependencies } from "../data-preparation/prepare.js";

const config: DataBuilderConfig = {
  configPath: "/workspace/builder/config.yaml", datasetName: "eval-v1",
  paths: {
    baselineProject: "/workspace/baseline", nativeProject: "/workspace/native",
    skillDataset: "/datasets/skills", memoryDataset: "/datasets/memories",
    labRoot: "/lab", initialCoreData: "/lab/seed/core",
  },
  identity: { serviceId: "rhino-ab", userId: "usr", teamId: "team", agentId: "agent" },
  builder: { corePort: 28420, panelPort: 28124, webPort: 25173 },
  targets: { baselineCorePort: 8420, nativeCorePort: 18420 },
  processing: { timeoutMs: 1000, l2WaitMs: 100, pollIntervalMs: 100, idleConfirmations: 2 },
};

const inspection: InputInspection = {
  memoryCoreVersion: "2.0.0", skillNames: ["skill-a"],
  sessions: [{ sessionId: "session-a", messageCount: 4 }], totalMessages: 4,
};

const layout: BuilderLayout = {
  root: "/lab/data-builder", configDirectory: "/lab/data-builder/config", secretsDirectory: "/lab/data-builder/secrets",
  logsDirectory: "/lab/data-builder/logs", coreDataDirectory: "/lab/data-builder/data/core",
  releasesDirectory: "/lab/data-builder/releases", backupsDirectory: "/lab/data-builder/backups",
  coreConfigPath: "/lab/data-builder/config/core.yaml", coreEnvironmentPath: "/lab/data-builder/secrets/core.env",
  panelEnvironmentPath: "/lab/data-builder/config/panel.env", webEnvironmentPath: "/lab/data-builder/config/web.env",
  metadataInstancesPath: "/lab/data-builder/secrets/metadata-instances.json", gatewayKeyPath: "/lab/data-builder/secrets/core-gateway.key",
  unitDirectory: "/units",
};

const release: DataBuilderRelease = {
  releaseId: "eval-v1-123456789abc", directory: "/lab/data-builder/releases/eval-v1-123456789abc",
  coreDirectory: "/lab/data-builder/releases/eval-v1-123456789abc/core",
  manifestPath: "/lab/data-builder/releases/eval-v1-123456789abc/manifest.json",
  manifest: {
    schemaVersion: 1, releaseId: "eval-v1-123456789abc", datasetName: "eval-v1", inputDigest: "123456789abcdef",
    sourceRevision: "tree:runtime-hash", memoryCoreVersion: "2.0.0", createdAt: "2026-09-04T12:00:00.000Z",
    identity: config.identity, skillNames: inspection.skillNames, sessions: inspection.sessions,
    totalMessages: inspection.totalMessages, files: [],
  },
};

function dependencies(existingRelease: DataBuilderRelease | null): { deps: PrepareDataBuilderDependencies; events: string[] } {
  const events: string[] = [];
  const deps: PrepareDataBuilderDependencies = {
    loadConfig: async () => config,
    inspectInputs: async () => inspection,
    sourceRevision: async () => "tree:runtime-hash",
    computeDigest: async () => "123456789abcdef",
    getLayout: () => layout,
    prepareRuntime: async () => { events.push("prepare-runtime"); return layout; },
    readRelease: async () => existingRelease,
    stopBuilder: async () => { events.push("stop-builder"); },
    resetBuilder: async () => { events.push("reset-builder"); return "/backup/build"; },
    restoreBuilder: async () => { events.push("restore-builder"); return "/backup/reuse"; },
    startBuilder: async () => { events.push("start-builder"); },
    waitForCore: async (url) => { events.push(`wait:${url}`); },
    readKey: async (path) => { events.push(`key:${path}`); return "api-key"; },
    importSkills: async () => { events.push("import-skills"); return { target: "data-builder", directory: config.paths.skillDataset, dryRun: false, items: [] }; },
    importMemories: async () => { events.push("import-memories"); return { target: "data-builder", directory: config.paths.memoryDataset, dryRun: false, items: [] }; },
    waitForProcessing: async () => { events.push("wait-processing"); return {
      l1: { queued: 0, running: 0, queued_sessions: [], running_sessions: [], idle: true },
      l2: { queued: 0, running: 0, queued_sessions: [], running_sessions: [], idle: true },
      l3: { queued: 0, running: 0, queued_sessions: [], running_sessions: [], idle: true },
    }; },
    createRelease: async () => { events.push("create-release"); return release; },
    verifyTarget: async ({ target }) => { events.push(`verify:${target.label}`); return { target: target.label, sessions: 1, messages: 4, skills: 1, pipelineIdle: true }; },
    installRelease: async (options) => {
      events.push("install-targets");
      await options.verify?.([
        { variant: "baseline", coreDirectory: "/lab/baseline/data/core", receiptPath: "/lab/baseline/data-builder-release.json" },
        { variant: "native", coreDirectory: "/lab/native/data/core", receiptPath: "/lab/native/data-builder-release.json" },
      ]);
      return { releaseId: release.releaseId, backupDirectory: "/lab/run/backup", targets: [] };
    },
    timestamp: () => "20260904T120000Z",
  };
  return { deps, events };
}

describe("prepareDataBuilder", () => {
  test("check mode validates and describes the work without writing or starting services", async () => {
    const { deps, events } = dependencies(null);
    const result = await prepareDataBuilder("/workspace/builder/config.yaml", { check: true, dependencies: deps });

    expect(result).toMatchObject({ mode: "check", releaseId: release.releaseId, reusedRelease: false, inspection });
    expect(events).toEqual([]);
  });

  test("builds once, waits for extraction, freezes the result and installs it in both targets", async () => {
    const { deps, events } = dependencies(null);
    const result = await prepareDataBuilder(config.configPath, { dependencies: deps });

    expect(result.mode).toBe("prepared");
    expect(result.reusedRelease).toBe(false);
    expect(events).toEqual([
      "prepare-runtime", `key:${layout.gatewayKeyPath}`,
      "stop-builder", "reset-builder", "start-builder", "wait:http://127.0.0.1:28420",
      "import-skills", "import-memories", "wait-processing", "verify:data-builder",
      "stop-builder", "create-release", "start-builder", "wait:http://127.0.0.1:28420",
      "install-targets",
      "wait:http://127.0.0.1:8420", `key:${join(config.paths.labRoot, "baseline", "secrets", "core-gateway.key")}`, "verify:baseline",
      "wait:http://127.0.0.1:18420", `key:${join(config.paths.labRoot, "native", "secrets", "core-gateway.key")}`, "verify:native",
    ]);
  });

  test("reuses an unchanged release without importing or calling the LLM again", async () => {
    const { deps, events } = dependencies(release);
    const importSkills = vi.spyOn(deps, "importSkills");
    const importMemories = vi.spyOn(deps, "importMemories");

    const result = await prepareDataBuilder(config.configPath, { dependencies: deps });

    expect(result.reusedRelease).toBe(true);
    expect(events).toContain("restore-builder");
    expect(events).not.toContain("reset-builder");
    expect(events).not.toContain("wait-processing");
    expect(importSkills).not.toHaveBeenCalled();
    expect(importMemories).not.toHaveBeenCalled();
  });
});
