import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { importMemoryDirectory, type MemoryImportResult, type MemoryImportTarget } from "../importers/memories/importer.js";
import { importSkillDirectory, type SkillImportResult, type SkillImportTarget } from "../importers/skills/importer.js";
import { inspectDataBuilderInputs, loadDataBuilderConfig, type DataBuilderConfig, type InputInspection } from "./config.js";
import { installReleaseToTargets, type InstallReleaseOptions, type InstallResult } from "./install.js";
import {
  computeInputDigest,
  createRelease,
  expectedReleaseId,
  readPipelineStatus,
  readReusableRelease,
  waitForMemoryProcessing,
  type DataBuilderRelease,
  type PipelineStatus,
} from "./release.js";
import {
  getBuilderLayout,
  prepareBuilderRuntime,
  resetBuilderData,
  restoreBuilderDataFromRelease,
  startBuilderServices,
  stopBuilderServices,
  waitForCore,
  type BuilderLayout,
} from "./runtime.js";
import { readDataBuilderSourceRevision } from "./source.js";
import { verifyPreparedTarget, type VerificationResult, type VerificationTarget } from "./verify.js";

export type PrepareDataBuilderDependencies = {
  loadConfig: typeof loadDataBuilderConfig;
  inspectInputs: typeof inspectDataBuilderInputs;
  sourceRevision: typeof readDataBuilderSourceRevision;
  computeDigest: typeof computeInputDigest;
  getLayout: typeof getBuilderLayout;
  prepareRuntime: typeof prepareBuilderRuntime;
  readRelease: typeof readReusableRelease;
  stopBuilder: () => Promise<void>;
  resetBuilder: typeof resetBuilderData;
  restoreBuilder: typeof restoreBuilderDataFromRelease;
  startBuilder: () => Promise<void>;
  waitForCore: (baseUrl: string) => Promise<void>;
  readKey: (path: string) => Promise<string>;
  importSkills: (options: Parameters<typeof importSkillDirectory>[0]) => Promise<SkillImportResult>;
  importMemories: (options: Parameters<typeof importMemoryDirectory>[0]) => Promise<MemoryImportResult>;
  waitForProcessing: (
    config: DataBuilderConfig,
    target: { baseUrl: string; apiKey: string; serviceId: string },
    progress: (message: string) => void,
  ) => Promise<PipelineStatus>;
  createRelease: typeof createRelease;
  installRelease: (options: InstallReleaseOptions) => Promise<InstallResult>;
  verifyTarget: typeof verifyPreparedTarget;
  timestamp: () => string;
};

export type DataBuilderPreparationResult = {
  mode: "check" | "prepared";
  configPath: string;
  datasetName: string;
  inputDigest: string;
  releaseId: string;
  reusedRelease: boolean;
  inspection: InputInspection;
  builder: { coreUrl: string; memoryHubUrl: string };
  releaseDirectory?: string;
  targetBackupDirectory?: string;
  verification: VerificationResult[];
};

function utcTimestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "");
}

async function readKey(path: string): Promise<string> {
  const value = (await readFile(path, "utf8")).trim();
  if (!value) throw new Error(`API key file is empty: ${path}`);
  return value;
}

function defaultDependencies(): PrepareDataBuilderDependencies {
  return {
    loadConfig: loadDataBuilderConfig,
    inspectInputs: inspectDataBuilderInputs,
    sourceRevision: readDataBuilderSourceRevision,
    computeDigest: computeInputDigest,
    getLayout: getBuilderLayout,
    prepareRuntime: prepareBuilderRuntime,
    readRelease: readReusableRelease,
    stopBuilder: () => stopBuilderServices(),
    resetBuilder: resetBuilderData,
    restoreBuilder: restoreBuilderDataFromRelease,
    startBuilder: () => startBuilderServices(),
    waitForCore: (baseUrl) => waitForCore(baseUrl),
    readKey,
    importSkills: importSkillDirectory,
    importMemories: importMemoryDirectory,
    waitForProcessing: async (config, target, progress) => {
      let lastLine = "";
      return waitForMemoryProcessing(config, {
        getStatus: async () => {
          const status = await readPipelineStatus(target.baseUrl, target.apiKey, target.serviceId);
          const line = ["L1", "L2", "L3"].map((name) => {
            const value = status[name.toLowerCase() as "l1" | "l2" | "l3"];
            return `${name}: queued=${value.queued}, running=${value.running}`;
          }).join("; ");
          if (line !== lastLine) {
            progress(`Memory processing: ${line}`);
            lastLine = line;
          }
          return status;
        },
      });
    },
    createRelease,
    installRelease: installReleaseToTargets,
    verifyTarget: verifyPreparedTarget,
    timestamp: utcTimestamp,
  };
}

function importTarget(config: DataBuilderConfig, baseUrl: string, apiKey: string, label: string): SkillImportTarget & MemoryImportTarget {
  return { label, baseUrl, apiKey, ...config.identity };
}

function verificationTarget(
  config: DataBuilderConfig,
  variant: "baseline" | "native",
  apiKey: string,
): VerificationTarget {
  const port = variant === "baseline" ? config.targets.baselineCorePort : config.targets.nativeCorePort;
  return importTarget(config, `http://127.0.0.1:${port}`, apiKey, variant);
}

async function restartBuilder(
  dependencies: PrepareDataBuilderDependencies,
  coreUrl: string,
): Promise<void> {
  await dependencies.startBuilder();
  await dependencies.waitForCore(coreUrl);
}

export async function prepareDataBuilder(
  configPath: string,
  options: {
    check?: boolean;
    progress?: (message: string) => void;
    dependencies?: PrepareDataBuilderDependencies;
  } = {},
): Promise<DataBuilderPreparationResult> {
  const dependencies = options.dependencies ?? defaultDependencies();
  const progress = options.progress ?? (() => undefined);
  const config = await dependencies.loadConfig(resolve(configPath));
  const inspection = await dependencies.inspectInputs(config);
  const sourceRevision = await dependencies.sourceRevision(config);
  const inputDigest = await dependencies.computeDigest(config, inspection, sourceRevision);
  const releaseId = expectedReleaseId(config, inputDigest);
  const initialLayout = dependencies.getLayout(config);
  const reusable = await dependencies.readRelease(initialLayout, releaseId, inputDigest);
  const coreUrl = `http://127.0.0.1:${config.builder.corePort}`;
  const memoryHubUrl = `http://127.0.0.1:${config.builder.webPort}`;
  const baseResult = {
    configPath: config.configPath,
    datasetName: config.datasetName,
    inputDigest,
    releaseId,
    reusedRelease: reusable !== null,
    inspection,
    builder: { coreUrl, memoryHubUrl },
  };
  if (options.check) return { mode: "check", ...baseResult, verification: [] };

  progress(`Preparing isolated Data Builder runtime for ${config.datasetName}`);
  const layout = await dependencies.prepareRuntime(config);
  const builderKey = await dependencies.readKey(layout.gatewayKeyPath);
  const builderTarget = importTarget(config, coreUrl, builderKey, "data-builder");
  const timestamp = dependencies.timestamp();
  let release: DataBuilderRelease;

  if (reusable) {
    progress(`Reusing prepared release ${reusable.releaseId}; no Skill or Memory import will run`);
    await dependencies.stopBuilder();
    try {
      await dependencies.restoreBuilder(reusable.coreDirectory, layout, timestamp);
      await restartBuilder(dependencies, coreUrl);
    } catch (error) {
      await dependencies.startBuilder().catch(() => undefined);
      throw error;
    }
    await dependencies.verifyTarget({ target: builderTarget, inspection });
    release = reusable;
  } else {
    progress("Resetting the Data Builder to the configured clean Core data");
    await dependencies.stopBuilder();
    try {
      await dependencies.resetBuilder(config, layout, timestamp);
      await restartBuilder(dependencies, coreUrl);
    } catch (error) {
      await dependencies.startBuilder().catch(() => undefined);
      throw error;
    }

    progress(`Importing ${inspection.skillNames.length} Skill package(s) into the Data Builder`);
    await dependencies.importSkills({
      directory: config.paths.skillDataset,
      target: builderTarget,
      onConflict: "error",
      dryRun: false,
    });
    progress(`Importing ${inspection.totalMessages} L0 message(s) from ${inspection.sessions.length} session(s)`);
    await dependencies.importMemories({
      directory: config.paths.memoryDataset,
      target: builderTarget,
      onConflict: "error",
      dryRun: false,
    });
    progress("Waiting for L1/L2/L3 processing to finish");
    await dependencies.waitForProcessing(config, builderTarget, progress);
    await dependencies.verifyTarget({ target: builderTarget, inspection });

    progress("Stopping the Data Builder briefly to freeze a consistent Core data copy");
    await dependencies.stopBuilder();
    try {
      release = await dependencies.createRelease({
        config,
        inspection,
        layout,
        inputDigest,
        sourceRevision,
      });
    } finally {
      await restartBuilder(dependencies, coreUrl);
    }
  }

  const verification: VerificationResult[] = [];
  progress(`Installing ${release.releaseId} into Baseline and Native`);
  const installResult = await dependencies.installRelease({
    config,
    release,
    timestamp,
    verify: async () => {
      for (const variant of ["baseline", "native"] as const) {
        const targetCoreUrl = `http://127.0.0.1:${variant === "baseline" ? config.targets.baselineCorePort : config.targets.nativeCorePort}`;
        await dependencies.waitForCore(targetCoreUrl);
        const keyPath = resolve(config.paths.labRoot, variant, "secrets", "core-gateway.key");
        const target = verificationTarget(config, variant, await dependencies.readKey(keyPath));
        verification.push(await dependencies.verifyTarget({ target, inspection }));
      }
    },
  });

  progress(`Prepared data installed successfully; previous target data retained at ${installResult.backupDirectory}`);
  return {
    mode: "prepared",
    ...baseResult,
    releaseDirectory: release.directory,
    targetBackupDirectory: installResult.backupDirectory,
    verification,
  };
}
