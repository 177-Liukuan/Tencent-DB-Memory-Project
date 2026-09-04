import { cp, lstat, mkdir, mkdtemp, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { DataBuilderConfig } from "./config.js";
import type { DataBuilderRelease } from "./release.js";
import { runCommand, type CommandRunner } from "./runtime.js";

const STOP_UNITS = [
  "tdam-baseline-proxy.service",
  "tdam-baseline-web.service",
  "tdam-baseline-panel.service",
  "tdam-baseline-core.service",
  "tdam-native-proxy.service",
  "tdam-native-web.service",
  "tdam-native-panel.service",
  "tdam-native-core.service",
] as const;

const START_UNITS = [
  "tdam-baseline-core.service",
  "tdam-native-core.service",
  "tdam-baseline-panel.service",
  "tdam-baseline-web.service",
  "tdam-baseline-proxy.service",
  "tdam-native-panel.service",
  "tdam-native-web.service",
  "tdam-native-proxy.service",
] as const;

type Variant = "baseline" | "native";

type TargetPaths = {
  variant: Variant;
  dataDirectory: string;
  coreDirectory: string;
  receiptPath: string;
  stagedCoreDirectory: string;
  backupCoreDirectory: string;
  backupReceiptPath: string;
  failedCoreDirectory: string;
};

export type InstallResult = {
  releaseId: string;
  backupDirectory: string;
  targets: Array<{ variant: Variant; coreDirectory: string; receiptPath: string }>;
};

export type InstallReleaseOptions = {
  config: DataBuilderConfig;
  release: DataBuilderRelease;
  timestamp?: string;
  run?: CommandRunner;
  adjustNativeReferences?: (coreDirectory: string) => Promise<void>;
  verify?: (targets: Array<{ variant: Variant; coreDirectory: string; receiptPath: string }>) => Promise<void>;
};

async function exists(path: string): Promise<boolean> {
  return Boolean(await lstat(path).catch(() => null));
}

function safeTimestamp(value: string): string {
  if (!/^\d{8}T\d{6}(?:\d{3})?Z$/.test(value)) throw new Error(`Invalid installation timestamp: ${value}`);
  return value;
}

function utcTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

async function makeTargetPaths(
  config: DataBuilderConfig,
  variant: Variant,
  release: DataBuilderRelease,
  backupDirectory: string,
): Promise<TargetPaths> {
  const dataDirectory = resolve(config.paths.labRoot, variant, "data");
  await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
  const stagedCoreDirectory = await mkdtemp(join(dataDirectory, `.data-builder-${release.releaseId}-`));
  return {
    variant,
    dataDirectory,
    coreDirectory: resolve(dataDirectory, "core"),
    receiptPath: resolve(config.paths.labRoot, variant, "data-builder-release.json"),
    stagedCoreDirectory,
    backupCoreDirectory: resolve(backupDirectory, variant, "core"),
    backupReceiptPath: resolve(backupDirectory, variant, "data-builder-release.json"),
    failedCoreDirectory: resolve(backupDirectory, "failed-install", variant, "core"),
  };
}

async function stageRelease(release: DataBuilderRelease, target: TargetPaths): Promise<void> {
  await cp(release.coreDirectory, target.stagedCoreDirectory, {
    recursive: true,
    force: false,
    errorOnExist: false,
    preserveTimestamps: true,
  });
}

async function activateTarget(target: TargetPaths): Promise<void> {
  await mkdir(dirname(target.backupCoreDirectory), { recursive: true, mode: 0o700 });
  let coreMoved = false;
  let receiptMoved = false;
  try {
    if (await exists(target.coreDirectory)) {
      await rename(target.coreDirectory, target.backupCoreDirectory);
      coreMoved = true;
    }
    if (await exists(target.receiptPath)) {
      await rename(target.receiptPath, target.backupReceiptPath);
      receiptMoved = true;
    }
    await rename(target.stagedCoreDirectory, target.coreDirectory);
  } catch (error) {
    if (receiptMoved) await rename(target.backupReceiptPath, target.receiptPath).catch(() => undefined);
    if (coreMoved) await rename(target.backupCoreDirectory, target.coreDirectory).catch(() => undefined);
    throw error;
  }
}

async function restoreTarget(target: TargetPaths): Promise<void> {
  if (await exists(target.coreDirectory)) {
    await mkdir(dirname(target.failedCoreDirectory), { recursive: true, mode: 0o700 });
    await rename(target.coreDirectory, target.failedCoreDirectory);
  }
  if (await exists(target.backupCoreDirectory)) await rename(target.backupCoreDirectory, target.coreDirectory);
  if (await exists(target.receiptPath)) {
    const failedReceipt = resolve(dirname(target.failedCoreDirectory), "data-builder-release.json");
    await mkdir(dirname(failedReceipt), { recursive: true, mode: 0o700 });
    await rename(target.receiptPath, failedReceipt);
  }
  if (await exists(target.backupReceiptPath)) await rename(target.backupReceiptPath, target.receiptPath);
}

async function writeReceipt(
  target: TargetPaths,
  release: DataBuilderRelease,
  installedAt: string,
): Promise<void> {
  await writeFile(target.receiptPath, `${JSON.stringify({
    schemaVersion: 1,
    releaseId: release.releaseId,
    inputDigest: release.manifest.inputDigest,
    datasetName: release.manifest.datasetName,
    installedAt,
  }, null, 2)}\n`, { mode: 0o600 });
}

export async function adjustNativeCoreReferences(
  coreDirectory: string,
  serviceId: string,
  run: CommandRunner = runCommand,
): Promise<void> {
  const updates = [
    {
      path: resolve(coreDirectory, "metadata", `tdai_metadata_${serviceId}`, "metadata.db"),
      sql: "UPDATE meta_assets SET content_ref=REPLACE(content_ref,'127.0.0.1:8421','127.0.0.1:18421') WHERE content_ref LIKE '%127.0.0.1:8421%';",
    },
    {
      path: resolve(coreDirectory, "instances", serviceId, "vectors.db"),
      sql: "UPDATE entity_knowledge SET service_url=REPLACE(service_url,'127.0.0.1:8421','127.0.0.1:18421') WHERE service_url LIKE '%127.0.0.1:8421%';",
    },
  ];
  for (const update of updates) {
    if (await exists(update.path)) await run("sqlite3", [update.path, update.sql]);
  }
}

export async function installReleaseToTargets(options: InstallReleaseOptions): Promise<InstallResult> {
  const run = options.run ?? runCommand;
  const timestamp = safeTimestamp(options.timestamp ?? utcTimestamp());
  const backupDirectory = resolve(options.config.paths.labRoot, "run", "data-builder-backups", timestamp);
  if (await exists(backupDirectory)) throw new Error(`Installation backup already exists: ${backupDirectory}`);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });

  const targets = await Promise.all((["baseline", "native"] as const).map((variant) => (
    makeTargetPaths(options.config, variant, options.release, backupDirectory)
  )));
  await Promise.all(targets.map((target) => stageRelease(options.release, target)));

  const activated: TargetPaths[] = [];
  let stopAttempted = false;
  try {
    stopAttempted = true;
    await run("systemctl", ["--user", "stop", ...STOP_UNITS]);
    for (const target of targets) {
      await activateTarget(target);
      activated.push(target);
    }
    const native = targets.find((target) => target.variant === "native");
    if (!native) throw new Error("Native target is missing");
    const adjust = options.adjustNativeReferences
      ?? ((coreDirectory: string) => adjustNativeCoreReferences(coreDirectory, options.config.identity.serviceId, run));
    await adjust(native.coreDirectory);
    const installedAt = new Date().toISOString();
    for (const target of targets) await writeReceipt(target, options.release, installedAt);
    await run("systemctl", ["--user", "start", ...START_UNITS]);
    const installedTargets = targets.map((target) => ({
      variant: target.variant,
      coreDirectory: target.coreDirectory,
      receiptPath: target.receiptPath,
    }));
    await options.verify?.(installedTargets);
    stopAttempted = false;
    return {
      releaseId: options.release.releaseId,
      backupDirectory,
      targets: installedTargets,
    };
  } catch (error) {
    const original = error instanceof Error ? error.message : String(error);
    const recoveryErrors: string[] = [];
    if (stopAttempted) {
      await run("systemctl", ["--user", "stop", ...STOP_UNITS]).catch((recoveryError) => {
        recoveryErrors.push(`could not stop partially started services: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
      });
    }
    for (const target of [...activated].reverse()) {
      await restoreTarget(target).catch((recoveryError) => {
        recoveryErrors.push(`${target.variant} restore failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
      });
    }
    if (stopAttempted) {
      await run("systemctl", ["--user", "start", ...START_UNITS]).catch((recoveryError) => {
        recoveryErrors.push(`could not restart previous services: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
      });
    }
    const recovery = recoveryErrors.length === 0 ? "rolled back to the previous data" : `rollback was incomplete (${recoveryErrors.join("; ")})`;
    throw new Error(`Data Builder installation failed and ${recovery}: ${original}`);
  }
}
