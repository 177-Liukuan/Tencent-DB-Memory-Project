import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import type { DataBuilderConfig } from "../data-preparation/config.js";
import {
  prepareBuilderRuntime,
  resetBuilderData,
  restoreBuilderDataFromRelease,
  startBuilderServices,
  stopBuilderServices,
  type CommandRunner,
} from "../data-preparation/runtime.js";

function config(root: string): DataBuilderConfig {
  return {
    configPath: join(root, "config.yaml"),
    datasetName: "test-data",
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
    processing: { timeoutMs: 10_000, l2WaitMs: 0, pollIntervalMs: 100, idleConfirmations: 2 },
  };
}

async function sourceFiles(root: string): Promise<void> {
  await mkdir(join(root, "baseline", "MemoryCore"), { recursive: true });
  await mkdir(join(root, "baseline", "MemoryPanel", "web"), { recursive: true });
  await mkdir(join(root, "lab", "baseline", "config"), { recursive: true });
  await mkdir(join(root, "lab", "baseline", "secrets"), { recursive: true });
  await writeFile(join(root, "lab", "baseline", "config", "core.yaml"), `
deployMode: standalone
instanceId: rhino-ab
server: { host: 127.0.0.1, port: 8420 }
data: { baseDir: /old/baseline/core }
llm: { provider: openai, model: test-model }
memory: { capture: { enabled: true } }
`);
  await writeFile(join(root, "lab", "baseline", "secrets", "core.env"), [
    "HOME=/home/test",
    "PATH=/usr/bin:/bin",
    "TDAI_GATEWAY_CONFIG=/old/baseline/config/core.yaml",
    "TDAI_GATEWAY_PORT=8420",
    "TDAI_DATA_DIR=/old/baseline/data/core",
    "TDAI_GATEWAY_API_KEY=secret-core-key",
    "TDAI_LLM_API_KEY=secret-llm-key",
    "LANGFUSE_TRACING_ENVIRONMENT=baseline",
    "LANGFUSE_RELEASE=baseline-release",
    "",
  ].join("\n"));
  for (const [name, value] of [
    ["core-gateway.key", "secret-core-key\n"],
    ["admin-user.key", "secret-admin-key\n"],
    ["memory-user.key", "secret-user-key\n"],
  ] as const) await writeFile(join(root, "lab", "baseline", "secrets", name), value);
}

describe("prepareBuilderRuntime", () => {
  test("writes isolated Core and Memory Hub settings without changing source secrets", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-runtime-"));
    await sourceFiles(root);
    const unitDirectory = join(root, "units");

    const layout = await prepareBuilderRuntime(config(root), { unitDirectory });

    const coreConfig = await readFile(layout.coreConfigPath, "utf8");
    expect(coreConfig).toContain("port: 28420");
    expect(coreConfig).toContain(`baseDir: ${join(root, "lab", "data-builder", "data", "core")}`);
    const coreEnvironment = await readFile(layout.coreEnvironmentPath, "utf8");
    expect(coreEnvironment).toContain(`TDAI_GATEWAY_CONFIG=${layout.coreConfigPath}`);
    expect(coreEnvironment).toContain("TDAI_GATEWAY_PORT=28420");
    expect(coreEnvironment).toContain("LANGFUSE_TRACING_ENVIRONMENT=data-builder");
    expect(coreEnvironment).toContain("TDAI_LLM_API_KEY=secret-llm-key");
    expect((await stat(layout.coreEnvironmentPath)).mode & 0o777).toBe(0o600);

    const instances = JSON.parse(await readFile(layout.metadataInstancesPath, "utf8")) as {
      instances: Array<Record<string, unknown>>;
    };
    expect(instances.instances[0]).toMatchObject({
      id: "rhino-ab",
      gateway_endpoint: "http://127.0.0.1:28420",
      api_key: "secret-core-key",
    });
    expect((await stat(layout.metadataInstancesPath)).mode & 0o777).toBe(0o600);

    const coreUnit = await readFile(join(unitDirectory, "tdam-data-builder-core.service"), "utf8");
    expect(coreUnit).toContain(`WorkingDirectory="${join(root, "baseline", "MemoryCore")}"`);
    expect(coreUnit).toContain(layout.coreEnvironmentPath);
    const webUnit = await readFile(join(unitDirectory, "tdam-data-builder-web.service"), "utf8");
    expect(webUnit).toContain("--port 25173 --strictPort");
  });
});

describe("resetBuilderData", () => {
  test("retains previous builder data and copies the configured initial Core data", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-reset-"));
    await sourceFiles(root);
    await mkdir(join(root, "seed", "core"), { recursive: true });
    await writeFile(join(root, "seed", "core", "initial.txt"), "initial");
    const layout = await prepareBuilderRuntime(config(root), { unitDirectory: join(root, "units") });
    await mkdir(layout.coreDataDirectory, { recursive: true });
    await writeFile(join(layout.coreDataDirectory, "old.txt"), "old");

    const backup = await resetBuilderData(config(root), layout, "20260904T120000Z");

    expect(await readFile(join(layout.coreDataDirectory, "initial.txt"), "utf8")).toBe("initial");
    expect(await readFile(join(backup, "old.txt"), "utf8")).toBe("old");
  });

  test("can put a reusable frozen release back into the Data Builder", async () => {
    const root = await mkdtemp(join(tmpdir(), "data-builder-reuse-"));
    await sourceFiles(root);
    const releaseCore = join(root, "release", "core");
    await mkdir(releaseCore, { recursive: true });
    await writeFile(join(releaseCore, "prepared.txt"), "prepared once");
    const layout = await prepareBuilderRuntime(config(root), { unitDirectory: join(root, "units") });
    await mkdir(layout.coreDataDirectory, { recursive: true });
    await writeFile(join(layout.coreDataDirectory, "old.txt"), "old");

    const backup = await restoreBuilderDataFromRelease(releaseCore, layout, "20260904T121500Z");

    expect(await readFile(join(layout.coreDataDirectory, "prepared.txt"), "utf8")).toBe("prepared once");
    expect(await readFile(join(backup, "old.txt"), "utf8")).toBe("old");
  });
});

describe("builder service control", () => {
  test("controls only the three data-builder units", async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const run: CommandRunner = async (command, args) => { calls.push({ command, args }); };

    await stopBuilderServices(run);
    await startBuilderServices(run);

    expect(calls).toEqual([
      { command: "systemctl", args: ["--user", "stop", "tdam-data-builder-web.service", "tdam-data-builder-panel.service", "tdam-data-builder-core.service"] },
      { command: "systemctl", args: ["--user", "daemon-reload"] },
      { command: "systemctl", args: ["--user", "start", "tdam-data-builder-core.service", "tdam-data-builder-panel.service", "tdam-data-builder-web.service"] },
    ]);
    expect(JSON.stringify(calls)).not.toContain("baseline");
    expect(JSON.stringify(calls)).not.toContain("native");
  });
});
