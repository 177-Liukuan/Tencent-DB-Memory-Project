import { spawn } from "node:child_process";
import { chmod, copyFile, cp, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { dump as dumpYaml, load as parseYaml } from "js-yaml";

import type { DataBuilderConfig } from "./config.js";

const BUILDER_UNITS = [
  "tdam-data-builder-core.service",
  "tdam-data-builder-panel.service",
  "tdam-data-builder-web.service",
] as const;

export type CommandRunner = (command: string, args: string[]) => Promise<void>;

export type BuilderLayout = {
  root: string;
  configDirectory: string;
  secretsDirectory: string;
  logsDirectory: string;
  coreDataDirectory: string;
  releasesDirectory: string;
  backupsDirectory: string;
  coreConfigPath: string;
  coreEnvironmentPath: string;
  panelEnvironmentPath: string;
  webEnvironmentPath: string;
  metadataInstancesPath: string;
  gatewayKeyPath: string;
  unitDirectory: string;
};

type RuntimeOptions = { unitDirectory?: string };
type UnknownRecord = Record<string, unknown>;

function object(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function safeUnitValue(value: string): string {
  if (value.includes("\n") || value.includes("\r")) throw new Error("systemd paths must not contain newlines");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

async function secureWrite(path: string, content: string): Promise<void> {
  await writeFile(path, content, { mode: 0o600 });
  await chmod(path, 0o600);
}

function environmentMap(raw: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 1) throw new Error(`Invalid environment line: ${line}`);
    result.set(line.slice(0, equals), line.slice(equals + 1));
  }
  return result;
}

function serializedEnvironment(values: Map<string, string>): string {
  return `${Array.from(values, ([key, value]) => `${key}=${value}`).join("\n")}\n`;
}

export function getBuilderLayout(config: DataBuilderConfig, options: RuntimeOptions = {}): BuilderLayout {
  const root = resolve(config.paths.labRoot, "data-builder");
  const configDirectory = resolve(root, "config");
  const secretsDirectory = resolve(root, "secrets");
  const logsDirectory = resolve(root, "logs");
  return {
    root,
    configDirectory,
    secretsDirectory,
    logsDirectory,
    coreDataDirectory: resolve(root, "data", "core"),
    releasesDirectory: resolve(root, "releases"),
    backupsDirectory: resolve(root, "backups"),
    coreConfigPath: resolve(configDirectory, "core.yaml"),
    coreEnvironmentPath: resolve(secretsDirectory, "core.env"),
    panelEnvironmentPath: resolve(configDirectory, "panel.env"),
    webEnvironmentPath: resolve(configDirectory, "web.env"),
    metadataInstancesPath: resolve(secretsDirectory, "metadata-instances.json"),
    gatewayKeyPath: resolve(secretsDirectory, "core-gateway.key"),
    unitDirectory: resolve(options.unitDirectory ?? resolve(homedir(), ".config", "systemd", "user")),
  };
}

function coreUnit(config: DataBuilderConfig, layout: BuilderLayout): string {
  const node = process.execPath;
  return `[Unit]
Description=TencentDB Agent Memory Data Builder Core
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${safeUnitValue(resolve(config.paths.baselineProject, "MemoryCore"))}
EnvironmentFile=${safeUnitValue(layout.coreEnvironmentPath)}
ExecStart=${safeUnitValue(node)} --import tsx src/gateway/server.ts
Restart=on-failure
RestartSec=3
StandardOutput=append:${layout.logsDirectory}/core.log
StandardError=append:${layout.logsDirectory}/core.log
`;
}

function panelUnit(config: DataBuilderConfig, layout: BuilderLayout): string {
  return `[Unit]
Description=TencentDB Agent Memory Data Builder Panel Backend
Requires=tdam-data-builder-core.service
After=tdam-data-builder-core.service

[Service]
Type=simple
WorkingDirectory=${safeUnitValue(resolve(config.paths.baselineProject, "MemoryPanel"))}
EnvironmentFile=${safeUnitValue(layout.panelEnvironmentPath)}
ExecStart=${safeUnitValue(process.execPath)} --import tsx src/index.ts
Restart=on-failure
RestartSec=3
StandardOutput=append:${layout.logsDirectory}/panel.log
StandardError=append:${layout.logsDirectory}/panel.log
`;
}

function webUnit(config: DataBuilderConfig, layout: BuilderLayout): string {
  const npm = resolve(dirname(process.execPath), "npm");
  return `[Unit]
Description=TencentDB Agent Memory Data Builder Panel Web
Requires=tdam-data-builder-panel.service
After=tdam-data-builder-panel.service

[Service]
Type=simple
WorkingDirectory=${safeUnitValue(resolve(config.paths.baselineProject, "MemoryPanel", "web"))}
EnvironmentFile=${safeUnitValue(layout.webEnvironmentPath)}
ExecStart=${safeUnitValue(npm)} run dev -- --host 127.0.0.1 --port ${config.builder.webPort} --strictPort
Restart=on-failure
RestartSec=3
StandardOutput=append:${layout.logsDirectory}/web.log
StandardError=append:${layout.logsDirectory}/web.log
`;
}

export async function prepareBuilderRuntime(
  config: DataBuilderConfig,
  options: RuntimeOptions = {},
): Promise<BuilderLayout> {
  const layout = getBuilderLayout(config, options);
  for (const directory of [
    layout.configDirectory,
    layout.secretsDirectory,
    layout.logsDirectory,
    layout.releasesDirectory,
    layout.backupsDirectory,
    layout.unitDirectory,
    dirname(layout.coreDataDirectory),
  ]) await mkdir(directory, { recursive: true, mode: 0o700 });

  const baselineConfigPath = resolve(config.paths.labRoot, "baseline", "config", "core.yaml");
  const baselineCoreConfig = object(parseYaml(await readFile(baselineConfigPath, "utf8")));
  baselineCoreConfig.server = {
    ...object(baselineCoreConfig.server),
    host: "127.0.0.1",
    port: config.builder.corePort,
  };
  baselineCoreConfig.data = {
    ...object(baselineCoreConfig.data),
    baseDir: layout.coreDataDirectory,
  };
  await secureWrite(layout.coreConfigPath, dumpYaml(baselineCoreConfig, { noRefs: true, lineWidth: 120 }));

  const baselineSecrets = resolve(config.paths.labRoot, "baseline", "secrets");
  const coreEnvironment = environmentMap(await readFile(resolve(baselineSecrets, "core.env"), "utf8"));
  coreEnvironment.set("TDAI_GATEWAY_CONFIG", layout.coreConfigPath);
  coreEnvironment.set("TDAI_GATEWAY_HOST", "127.0.0.1");
  coreEnvironment.set("TDAI_GATEWAY_PORT", String(config.builder.corePort));
  coreEnvironment.set("TDAI_DATA_DIR", layout.coreDataDirectory);
  coreEnvironment.set("LANGFUSE_TRACING_ENVIRONMENT", "data-builder");
  coreEnvironment.set("LANGFUSE_RELEASE", `data-builder:${config.datasetName}`);
  await secureWrite(layout.coreEnvironmentPath, serializedEnvironment(coreEnvironment));

  for (const name of ["core-gateway.key", "admin-user.key", "memory-user.key"]) {
    const destination = resolve(layout.secretsDirectory, name);
    await copyFile(resolve(baselineSecrets, name), destination);
    await chmod(destination, 0o600);
  }
  const gatewayKey = (await readFile(layout.gatewayKeyPath, "utf8")).trim();
  if (!gatewayKey) throw new Error(`Data Builder gateway key is empty: ${layout.gatewayKeyPath}`);
  await secureWrite(layout.metadataInstancesPath, `${JSON.stringify({
    instances: [{
      id: config.identity.serviceId,
      name: "TencentDB Agent Memory Data Builder",
      gateway_endpoint: `http://127.0.0.1:${config.builder.corePort}`,
      proxy_endpoint: "http://127.0.0.1:28096",
      api_key: gatewayKey,
    }],
  }, null, 2)}\n`);

  await secureWrite(layout.panelEnvironmentPath, [
    `HOME=${homedir()}`,
    `PATH=${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    "NO_PROXY=127.0.0.1,localhost",
    "no_proxy=127.0.0.1,localhost",
    "HOST=127.0.0.1",
    `PORT=${config.builder.panelPort}`,
    `METADATA_INSTANCES_CONFIG=${layout.metadataInstancesPath}`,
    "METADATA_REMOTE_TIMEOUT_MS=15000",
    "LOG_LEVEL=info",
    "LOG_FORMAT=json",
    `UI_DIST_DIR=${resolve(config.paths.baselineProject, "MemoryPanel", "web", "dist")}`,
    "KNOWLEDGE_SERVICE_URL=http://127.0.0.1:28421",
    "KNOWLEDGE_TIMEOUT_MS=30000",
    "KNOWLEDGE_LLM_BINDING_SYNC=false",
    "KNOWLEDGE_LLM_PROXY_BASE_URL=http://127.0.0.1:28096",
    "",
  ].join("\n"));
  await secureWrite(layout.webEnvironmentPath, [
    `HOME=${homedir()}`,
    `PATH=${dirname(process.execPath)}:/usr/local/bin:/usr/bin:/bin`,
    "NO_PROXY=127.0.0.1,localhost",
    "no_proxy=127.0.0.1,localhost",
    `VITE_TMC_BACKEND_URL=http://127.0.0.1:${config.builder.panelPort}`,
    `VITE_SKILL_GATEWAY_URL=http://127.0.0.1:${config.builder.corePort}`,
    "",
  ].join("\n"));

  await writeFile(resolve(layout.unitDirectory, BUILDER_UNITS[0]), coreUnit(config, layout));
  await writeFile(resolve(layout.unitDirectory, BUILDER_UNITS[1]), panelUnit(config, layout));
  await writeFile(resolve(layout.unitDirectory, BUILDER_UNITS[2]), webUnit(config, layout));
  return layout;
}

export async function resetBuilderData(
  config: DataBuilderConfig,
  layout: BuilderLayout,
  timestamp: string,
): Promise<string> {
  return replaceBuilderData(config.paths.initialCoreData, layout, timestamp, "build");
}

async function replaceBuilderData(
  sourceCoreDirectory: string,
  layout: BuilderLayout,
  timestamp: string,
  label: "build" | "reuse",
): Promise<string> {
  if (!/^\d{8}T\d{6}(?:\d{3})?Z$/.test(timestamp)) throw new Error(`Invalid Data Builder backup timestamp: ${timestamp}`);
  const backup = resolve(layout.backupsDirectory, `before-${label}-${timestamp}`, "core");
  const staging = resolve(dirname(layout.coreDataDirectory), `.data-builder-${label}-${timestamp}`);
  if (await stat(staging).catch(() => null)) throw new Error(`Data Builder staging directory already exists: ${staging}`);
  await mkdir(dirname(layout.coreDataDirectory), { recursive: true, mode: 0o700 });
  await cp(sourceCoreDirectory, staging, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  });
  const current = await stat(layout.coreDataDirectory).catch(() => null);
  if (current) {
    await mkdir(dirname(backup), { recursive: true, mode: 0o700 });
    await rename(layout.coreDataDirectory, backup);
  }
  await rename(staging, layout.coreDataDirectory).catch(async (error: unknown) => {
    if (current && await stat(backup).catch(() => null)) await rename(backup, layout.coreDataDirectory);
    throw error;
  });
  return backup;
}

export async function restoreBuilderDataFromRelease(
  releaseCoreDirectory: string,
  layout: BuilderLayout,
  timestamp: string,
): Promise<string> {
  return replaceBuilderData(releaseCoreDirectory, layout, timestamp, "reuse");
}

export const runCommand: CommandRunner = async (command, args) => {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} exited with ${code ?? `signal ${signal ?? "unknown"}`}`));
    });
  });
};

export async function stopBuilderServices(run: CommandRunner = runCommand): Promise<void> {
  await run("systemctl", ["--user", "stop", BUILDER_UNITS[2], BUILDER_UNITS[1], BUILDER_UNITS[0]]);
}

export async function startBuilderServices(run: CommandRunner = runCommand): Promise<void> {
  await run("systemctl", ["--user", "daemon-reload"]);
  await run("systemctl", ["--user", "start", BUILDER_UNITS[0], BUILDER_UNITS[1], BUILDER_UNITS[2]]);
}

export async function waitForCore(baseUrl: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not ready";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Data Builder MemoryCore did not become ready: ${lastError}`);
}
