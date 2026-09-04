import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, parse, relative, resolve } from "node:path";

import { load as parseYaml } from "js-yaml";
import { z } from "zod";

import { discoverMemorySessions } from "../importers/memories/importer.js";
import { discoverSkillPackages } from "../importers/skills/importer.js";

const portSchema = z.number().int().min(1024).max(65535);

const rawConfigSchema = z.strictObject({
  version: z.literal(1),
  datasetName: z.string().trim().min(1).max(64).regex(/^[a-z0-9][a-z0-9._-]*$/),
  paths: z.strictObject({
    baselineProject: z.string().trim().min(1),
    nativeProject: z.string().trim().min(1),
    skillDataset: z.string().trim().min(1),
    memoryDataset: z.string().trim().min(1),
    labRoot: z.string().trim().min(1),
    initialCoreData: z.string().trim().min(1),
  }),
  identity: z.strictObject({
    serviceId: z.string().trim().min(1).max(128),
    userId: z.string().trim().min(1).max(256),
    teamId: z.string().trim().min(1).max(256),
    agentId: z.string().trim().min(1).max(256),
  }),
  builder: z.strictObject({
    corePort: portSchema.default(28420),
    panelPort: portSchema.default(28124),
    webPort: portSchema.default(25173),
  }).default({ corePort: 28420, panelPort: 28124, webPort: 25173 }),
  targets: z.strictObject({
    baselineCorePort: portSchema.default(8420),
    nativeCorePort: portSchema.default(18420),
  }).default({ baselineCorePort: 8420, nativeCorePort: 18420 }),
  processing: z.strictObject({
    timeoutMinutes: z.number().positive().max(24 * 60).default(120),
    l2WaitSeconds: z.number().nonnegative().max(3600).default(95),
    pollIntervalMs: z.number().int().min(100).max(30_000).default(1000),
    idleConfirmations: z.number().int().min(1).max(20).default(3),
  }).default({ timeoutMinutes: 120, l2WaitSeconds: 95, pollIntervalMs: 1000, idleConfirmations: 3 }),
});

export type DataBuilderConfig = {
  configPath: string;
  datasetName: string;
  paths: {
    baselineProject: string;
    nativeProject: string;
    skillDataset: string;
    memoryDataset: string;
    labRoot: string;
    initialCoreData: string;
  };
  identity: {
    serviceId: string;
    userId: string;
    teamId: string;
    agentId: string;
  };
  builder: { corePort: number; panelPort: number; webPort: number };
  targets: { baselineCorePort: number; nativeCorePort: number };
  processing: {
    timeoutMs: number;
    l2WaitMs: number;
    pollIntervalMs: number;
    idleConfirmations: number;
  };
};

export type InputInspection = {
  memoryCoreVersion: string;
  skillNames: string[];
  sessions: Array<{ sessionId: string; messageCount: number }>;
  totalMessages: number;
};

function resolvedFrom(base: string, value: string): string {
  return resolve(base, value);
}

function within(parent: string, candidate: string): boolean {
  const offset = relative(parent, candidate);
  return offset === "" || (!offset.startsWith("..") && !isAbsolute(offset));
}

export async function loadDataBuilderConfig(path: string): Promise<DataBuilderConfig> {
  const configPath = resolve(path);
  const raw = await readFile(configPath, "utf8").catch((error: unknown) => {
    throw new Error(`Cannot read Data Builder config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  });
  let document: unknown;
  try {
    document = parseYaml(raw);
  } catch (error) {
    throw new Error(`Invalid Data Builder YAML ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const parsed = rawConfigSchema.safeParse(document);
  if (!parsed.success) {
    throw new Error(`Invalid Data Builder config ${configPath}: ${z.prettifyError(parsed.error)}`);
  }
  const ports = [
    parsed.data.builder.corePort,
    parsed.data.builder.panelPort,
    parsed.data.builder.webPort,
    parsed.data.targets.baselineCorePort,
    parsed.data.targets.nativeCorePort,
  ];
  if (new Set(ports).size !== ports.length) throw new Error("builder and target Core ports must all be different");
  const base = dirname(configPath);
  const paths = {
    baselineProject: resolvedFrom(base, parsed.data.paths.baselineProject),
    nativeProject: resolvedFrom(base, parsed.data.paths.nativeProject),
    skillDataset: resolvedFrom(base, parsed.data.paths.skillDataset),
    memoryDataset: resolvedFrom(base, parsed.data.paths.memoryDataset),
    labRoot: resolvedFrom(base, parsed.data.paths.labRoot),
    initialCoreData: resolvedFrom(base, parsed.data.paths.initialCoreData),
  };
  if (paths.labRoot === parse(paths.labRoot).root || paths.labRoot === resolve(homedir())) {
    throw new Error(`labRoot is too broad for recoverable data replacement: ${paths.labRoot}`);
  }
  if (paths.baselineProject === paths.nativeProject) {
    throw new Error("baselineProject and nativeProject must be different directories");
  }
  const replaceableCoreDirectories = [
    resolve(paths.labRoot, "baseline", "data", "core"),
    resolve(paths.labRoot, "native", "data", "core"),
    resolve(paths.labRoot, "data-builder", "data", "core"),
  ];
  if (replaceableCoreDirectories.some((target) => within(target, paths.initialCoreData))) {
    throw new Error("initialCoreData must not be inside a Core directory that the Data Builder replaces");
  }
  return {
    configPath,
    datasetName: parsed.data.datasetName,
    paths,
    identity: parsed.data.identity,
    builder: parsed.data.builder,
    targets: parsed.data.targets,
    processing: {
      timeoutMs: parsed.data.processing.timeoutMinutes * 60_000,
      l2WaitMs: parsed.data.processing.l2WaitSeconds * 1000,
      pollIntervalMs: parsed.data.processing.pollIntervalMs,
      idleConfirmations: parsed.data.processing.idleConfirmations,
    },
  };
}

async function requireDirectory(path: string, label: string): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (!info?.isDirectory()) throw new Error(`${label} directory does not exist: ${path}`);
}

async function packageVersion(path: string, label: string): Promise<string> {
  const raw = await readFile(path, "utf8").catch(() => null);
  if (raw === null) throw new Error(`${label} package does not exist: ${path}`);
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} package is not valid JSON: ${path}`);
  }
  const version = value && typeof value === "object" && typeof (value as { version?: unknown }).version === "string"
    ? (value as { version: string }).version.trim()
    : "";
  if (!version) throw new Error(`${label} package has no version: ${path}`);
  return version;
}

async function requireFile(path: string, label: string): Promise<void> {
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new Error(`${label} file does not exist: ${path}`);
}

export async function inspectDataBuilderInputs(config: DataBuilderConfig): Promise<InputInspection> {
  const baselineCore = resolve(config.paths.baselineProject, "MemoryCore");
  const nativeCore = resolve(config.paths.nativeProject, "MemoryCore");
  for (const [path, label] of [
    [baselineCore, "Baseline MemoryCore"],
    [resolve(config.paths.baselineProject, "MemoryPanel"), "Baseline MemoryPanel"],
    [resolve(config.paths.baselineProject, "MemoryPanel", "web"), "Baseline MemoryPanel web"],
    [nativeCore, "Native MemoryCore"],
    [resolve(config.paths.nativeProject, "MemoryPanel"), "Native MemoryPanel"],
    [resolve(config.paths.nativeProject, "MemoryPanel", "web"), "Native MemoryPanel web"],
    [config.paths.initialCoreData, "Initial Core data"],
  ] as const) {
    await requireDirectory(path, label);
  }
  const baselineVersion = await packageVersion(resolve(baselineCore, "package.json"), "Baseline MemoryCore");
  const nativeVersion = await packageVersion(resolve(nativeCore, "package.json"), "Native MemoryCore");
  if (baselineVersion !== nativeVersion) {
    throw new Error(`Baseline and Native MemoryCore versions differ: ${baselineVersion} != ${nativeVersion}`);
  }
  const baselineSecrets = resolve(config.paths.labRoot, "baseline", "secrets");
  for (const name of ["core.env", "core-gateway.key", "admin-user.key", "memory-user.key"]) {
    await requireFile(resolve(baselineSecrets, name), `Baseline ${name}`);
  }
  const [skills, sessions] = await Promise.all([
    discoverSkillPackages(config.paths.skillDataset),
    discoverMemorySessions(config.paths.memoryDataset),
  ]);
  return {
    memoryCoreVersion: baselineVersion,
    skillNames: skills.map((skill) => skill.name),
    sessions: sessions.map((session) => ({ sessionId: session.sessionId, messageCount: session.messages.length })),
    totalMessages: sessions.reduce((sum, session) => sum + session.messages.length, 0),
  };
}
