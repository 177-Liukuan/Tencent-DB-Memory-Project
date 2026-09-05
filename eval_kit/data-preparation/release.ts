import { createHash } from "node:crypto";
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import { discoverMemorySessions } from "../importers/memories/importer.js";
import { discoverSkillPackages } from "../importers/skills/importer.js";
import type { DataBuilderConfig, InputInspection } from "./config.js";
import type { BuilderLayout } from "./runtime.js";

export type PipelineLayerStatus = {
  queued: number;
  running: number;
  queued_sessions: string[];
  running_sessions: string[];
  idle: boolean;
};

export type PipelineStatus = {
  l1: PipelineLayerStatus;
  l2: PipelineLayerStatus;
  l3: PipelineLayerStatus;
};

type PipelineStatusEnvelope = { code: number; message?: string; data?: PipelineStatus };

export type ReleaseFile = { path: string; size: number; sha256: string };

export type DataBuilderReleaseManifest = {
  schemaVersion: 1;
  releaseId: string;
  datasetName: string;
  inputDigest: string;
  sourceRevision: string;
  memoryCoreVersion: string;
  createdAt: string;
  identity: DataBuilderConfig["identity"];
  skillNames: string[];
  sessions: Array<{ sessionId: string; messageCount: number }>;
  totalMessages: number;
  files: ReleaseFile[];
};

export type DataBuilderRelease = {
  releaseId: string;
  directory: string;
  coreDirectory: string;
  manifestPath: string;
  manifest: DataBuilderReleaseManifest;
};

type WaitDependencies = {
  getStatus: () => Promise<PipelineStatus>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

async function filesBelow(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symbolic links are not allowed in frozen data: ${path}`);
    if (entry.isDirectory()) files.push(...await filesBelow(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function portablePath(root: string, path: string): string {
  return relative(root, path).split(sep).join("/");
}

async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

async function fileManifest(root: string): Promise<ReleaseFile[]> {
  const result: ReleaseFile[] = [];
  for (const path of await filesBelow(root)) {
    const info = await stat(path);
    result.push({ path: portablePath(root, path), size: info.size, sha256: await sha256File(path) });
  }
  return result;
}

export async function computeInputDigest(
  config: DataBuilderConfig,
  inspection: InputInspection,
  sourceRevision: string,
): Promise<string> {
  const [skills, sessions, initialFiles] = await Promise.all([
    discoverSkillPackages(config.paths.skillDataset),
    discoverMemorySessions(config.paths.memoryDataset),
    fileManifest(config.paths.initialCoreData),
  ]);
  const payload = {
    schemaVersion: 1,
    datasetName: config.datasetName,
    identity: config.identity,
    memoryCoreVersion: inspection.memoryCoreVersion,
    sourceRevision,
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      content: skill.content,
      resources: skill.resources,
    })),
    sessions: sessions.map((session) => ({ sessionId: session.sessionId, messages: session.messages })),
    initialFiles,
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

function unfinished(status: PipelineStatus): string {
  const names = [["L1", status.l1], ["L2", status.l2], ["L3", status.l3]] as const;
  const active = names.filter(([, value]) => !value.idle).map(([name, value]) => {
    const sessions = [...new Set([...value.queued_sessions, ...value.running_sessions])].join(",") || "(unknown)";
    return `${name} queued=${value.queued} running=${value.running} sessions=${sessions}`;
  });
  return active.join("; ") || "status changed before completion confirmation";
}

export async function waitForMemoryProcessing(
  config: Pick<DataBuilderConfig, "processing">,
  dependencies: WaitDependencies,
): Promise<PipelineStatus> {
  const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms)));
  const now = dependencies.now ?? Date.now;
  const deadline = now() + config.processing.timeoutMs;
  let l1IdleSince: number | null = null;
  let allIdleCount = 0;
  let lastStatus: PipelineStatus | null = null;
  while (now() < deadline) {
    lastStatus = await dependencies.getStatus();
    if (!lastStatus.l1.idle) {
      l1IdleSince = null;
      allIdleCount = 0;
    } else {
      l1IdleSince ??= now();
      const l2WindowCovered = now() - l1IdleSince >= config.processing.l2WaitMs;
      const allIdle = lastStatus.l1.idle && lastStatus.l2.idle && lastStatus.l3.idle;
      allIdleCount = l2WindowCovered && allIdle ? allIdleCount + 1 : 0;
      if (allIdleCount >= config.processing.idleConfirmations) return lastStatus;
    }
    await sleep(config.processing.pollIntervalMs);
  }
  throw new Error(`Memory processing timed out: ${lastStatus ? unfinished(lastStatus) : "pipeline status unavailable"}`);
}

export async function readPipelineStatus(
  baseUrl: string,
  apiKey: string,
  serviceId: string,
): Promise<PipelineStatus> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/v2/pipeline/status`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "x-tdai-service-id": serviceId,
    },
    body: "{}",
    signal: AbortSignal.timeout(10_000),
  });
  const envelope = await response.json() as PipelineStatusEnvelope;
  if (!response.ok || envelope.code !== 0 || !envelope.data) {
    throw new Error(`Memory pipeline status failed (${envelope.code ?? response.status}): ${envelope.message ?? response.statusText}`);
  }
  return envelope.data;
}

function releaseId(config: DataBuilderConfig, inputDigest: string): string {
  return `${config.datasetName}-${inputDigest.slice(0, 12)}`;
}

function asRelease(directory: string, manifest: DataBuilderReleaseManifest): DataBuilderRelease {
  return {
    releaseId: manifest.releaseId,
    directory,
    coreDirectory: resolve(directory, "core"),
    manifestPath: resolve(directory, "manifest.json"),
    manifest,
  };
}

export async function createRelease(input: {
  config: DataBuilderConfig;
  inspection: InputInspection;
  layout: BuilderLayout;
  inputDigest: string;
  sourceRevision: string;
  createdAt?: string;
}): Promise<DataBuilderRelease> {
  const id = releaseId(input.config, input.inputDigest);
  const destination = resolve(input.layout.releasesDirectory, id);
  if (await lstat(destination).catch(() => null)) throw new Error(`Data Builder release already exists: ${destination}`);
  await mkdir(input.layout.releasesDirectory, { recursive: true, mode: 0o700 });
  const staging = await mkdtemp(resolve(input.layout.releasesDirectory, `.building-${id}-`));
  const coreDirectory = resolve(staging, "core");
  await cp(input.layout.coreDataDirectory, coreDirectory, {
    recursive: true,
    force: false,
    errorOnExist: true,
    preserveTimestamps: true,
  });
  const manifest: DataBuilderReleaseManifest = {
    schemaVersion: 1,
    releaseId: id,
    datasetName: input.config.datasetName,
    inputDigest: input.inputDigest,
    sourceRevision: input.sourceRevision,
    memoryCoreVersion: input.inspection.memoryCoreVersion,
    createdAt: input.createdAt ?? new Date().toISOString(),
    identity: input.config.identity,
    skillNames: input.inspection.skillNames,
    sessions: input.inspection.sessions,
    totalMessages: input.inspection.totalMessages,
    files: await fileManifest(coreDirectory),
  };
  await writeFile(resolve(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  await rename(staging, destination);
  return asRelease(destination, manifest);
}

function parsedManifest(value: unknown, path: string): DataBuilderReleaseManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid Data Builder release manifest: ${path}`);
  const manifest = value as Partial<DataBuilderReleaseManifest>;
  if (
    manifest.schemaVersion !== 1
    || typeof manifest.releaseId !== "string"
    || typeof manifest.inputDigest !== "string"
    || !Array.isArray(manifest.files)
  ) throw new Error(`Invalid Data Builder release manifest: ${path}`);
  return manifest as DataBuilderReleaseManifest;
}

export async function readReusableRelease(
  layout: BuilderLayout,
  id: string,
  expectedInputDigest: string,
): Promise<DataBuilderRelease | null> {
  const directory = resolve(layout.releasesDirectory, id);
  const manifestPath = resolve(directory, "manifest.json");
  const raw = await readFile(manifestPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (raw === null) return null;
  let document: unknown;
  try {
    document = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`Invalid Data Builder release manifest: ${manifestPath}`);
  }
  const manifest = parsedManifest(document, manifestPath);
  if (manifest.releaseId !== id || manifest.inputDigest !== expectedInputDigest) {
    throw new Error(`Data Builder release identity does not match its requested input: ${manifestPath}`);
  }
  const coreDirectory = resolve(directory, "core");
  const actualFiles = await fileManifest(coreDirectory);
  if (JSON.stringify(actualFiles) !== JSON.stringify(manifest.files)) {
    throw new Error(`Data Builder release file verification failed: ${directory}`);
  }
  return asRelease(directory, manifest);
}

export function expectedReleaseId(config: DataBuilderConfig, inputDigest: string): string {
  return releaseId(config, inputDigest);
}
