import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { DataBuilderConfig, InputInspection } from "../data-preparation/config.js";
import {
  computeInputDigest,
  createRelease,
  readReusableRelease,
  waitForMemoryProcessing,
  type PipelineStatus,
} from "../data-preparation/release.js";
import type { BuilderLayout } from "../data-preparation/runtime.js";

function config(root: string): DataBuilderConfig {
  return {
    configPath: join(root, "config.yaml"),
    datasetName: "eval-v1",
    paths: {
      baselineProject: join(root, "baseline"),
      nativeProject: join(root, "native"),
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

const inspection: InputInspection = {
  memoryCoreVersion: "2.0.0",
  skillNames: ["example-skill"],
  sessions: [{ sessionId: "session-1", messageCount: 2 }],
  totalMessages: 2,
};

async function inputFiles(root: string): Promise<void> {
  await mkdir(join(root, "skills", "example", "files"), { recursive: true });
  await writeFile(join(root, "skills", "example", "SKILL.md"), "---\nname: example-skill\ndescription: Example\n---\n");
  await writeFile(join(root, "skills", "example", "files", "guide.txt"), "guide");
  await mkdir(join(root, "memories"), { recursive: true });
  await writeFile(join(root, "memories", "session.json"), `${JSON.stringify({
    session_id: "session-1",
    messages: [
      { role: "user", content: "How should this service be deployed?" },
      { role: "assistant", content: "Use the documented rolling-deployment procedure." },
    ],
  })}\n`);
  await mkdir(join(root, "seed", "core"), { recursive: true });
  await writeFile(join(root, "seed", "core", "vectors.db"), "seed-db");
}

function layout(root: string): BuilderLayout {
  const runtime = join(root, "lab", "data-builder");
  return {
    root: runtime,
    configDirectory: join(runtime, "config"),
    secretsDirectory: join(runtime, "secrets"),
    logsDirectory: join(runtime, "logs"),
    coreDataDirectory: join(runtime, "data", "core"),
    releasesDirectory: join(runtime, "releases"),
    backupsDirectory: join(runtime, "backups"),
    coreConfigPath: join(runtime, "config", "core.yaml"),
    coreEnvironmentPath: join(runtime, "secrets", "core.env"),
    panelEnvironmentPath: join(runtime, "config", "panel.env"),
    webEnvironmentPath: join(runtime, "config", "web.env"),
    metadataInstancesPath: join(runtime, "secrets", "metadata-instances.json"),
    gatewayKeyPath: join(runtime, "secrets", "core-gateway.key"),
    unitDirectory: join(root, "units"),
  };
}

function layer(queued: number, running: number) {
  return { queued, running, queued_sessions: queued ? ["session-1"] : [], running_sessions: running ? ["session-1"] : [], idle: queued === 0 && running === 0 };
}

function status(l1: [number, number], l2: [number, number], l3: [number, number]): PipelineStatus {
  return { l1: layer(...l1), l2: layer(...l2), l3: layer(...l3) };
}

describe("computeInputDigest", () => {
  test("is stable for identical inputs and changes when effective dataset content changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-digest-"));
    await inputFiles(root);
    const first = await computeInputDigest(config(root), inspection, "commit-one");
    const second = await computeInputDigest(config(root), inspection, "commit-one");
    expect(first).toBe(second);

    await writeFile(join(root, "skills", "example", "files", "guide.txt"), "changed-guide");
    expect(await computeInputDigest(config(root), inspection, "commit-one")).not.toBe(first);
  });
});

describe("waitForMemoryProcessing", () => {
  test("waits for L1 to remain idle through the L2 delay and then confirms every layer is idle", async () => {
    const statuses = [
      status([0, 1], [0, 0], [0, 0]),
      status([0, 0], [0, 0], [0, 0]),
      status([0, 0], [0, 1], [0, 0]),
      status([0, 0], [0, 0], [0, 0]),
      status([0, 0], [0, 0], [0, 0]),
    ];
    let now = 0;
    let reads = 0;

    const result = await waitForMemoryProcessing(config("/tmp"), {
      getStatus: async () => statuses[Math.min(reads++, statuses.length - 1)] as PipelineStatus,
      sleep: async (ms) => { now += ms; },
      now: () => now,
    });

    expect(result).toEqual(status([0, 0], [0, 0], [0, 0]));
    expect(reads).toBe(5);
    expect(now).toBeGreaterThanOrEqual(40);
  });

  test("reports the unfinished layer and sessions on timeout", async () => {
    let now = 0;
    const busy = status([1, 0], [0, 0], [0, 0]);

    await expect(waitForMemoryProcessing(config("/tmp"), {
      getStatus: async () => busy,
      sleep: async (ms) => { now += ms; },
      now: () => now,
    })).rejects.toThrow(/L1.*session-1/);
  });
});

describe("frozen releases", () => {
  test("creates an immutable release and reuses it only while every recorded file matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-release-"));
    await inputFiles(root);
    const currentLayout = layout(root);
    await mkdir(currentLayout.coreDataDirectory, { recursive: true });
    await writeFile(join(currentLayout.coreDataDirectory, "vectors.db"), "built-data");
    const digest = await computeInputDigest(config(root), inspection, "commit-one");

    const release = await createRelease({
      config: config(root),
      inspection,
      layout: currentLayout,
      inputDigest: digest,
      sourceRevision: "commit-one",
      createdAt: "2026-09-04T12:00:00.000Z",
    });

    expect(release.releaseId).toBe(`eval-v1-${digest.slice(0, 12)}`);
    expect(await readFile(join(release.coreDirectory, "vectors.db"), "utf8")).toBe("built-data");
    expect((await readReusableRelease(currentLayout, release.releaseId, digest))?.releaseId).toBe(release.releaseId);

    await writeFile(join(release.coreDirectory, "vectors.db"), "corrupted");
    await expect(readReusableRelease(currentLayout, release.releaseId, digest)).rejects.toThrow("file verification failed");
  });
});
