import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

import type { DataBuilderConfig } from "./config.js";

const execFileAsync = promisify(execFile);

export type GitReader = (workingDirectory: string, args: string[]) => Promise<string>;

const defaultGitReader: GitReader = async (workingDirectory, args) => {
  const result = await execFileAsync("git", ["-C", workingDirectory, ...args], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  return result.stdout;
};

function publicEnvironment(raw: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line || line.startsWith("#")) return false;
      const key = line.slice(0, Math.max(line.indexOf("="), 0)).toUpperCase();
      return !["KEY", "TOKEN", "SECRET", "PASSWORD"].some((word) => key.includes(word));
    })
    .sort()
    .join("\n");
}

export async function readDataBuilderSourceRevision(
  config: DataBuilderConfig,
  git: GitReader = defaultGitReader,
): Promise<string> {
  const projects = [config.paths.baselineProject, config.paths.nativeProject] as const;
  const dirty = await Promise.all(projects.map((project) => git(project, ["status", "--porcelain", "--", "MemoryCore"])));
  const [baselineDirty = "", nativeDirty = ""] = dirty;
  if (baselineDirty.trim()) throw new Error("Baseline MemoryCore has uncommitted changes; commit or restore them before building evaluation data");
  if (nativeDirty.trim()) throw new Error("Native MemoryCore has uncommitted changes; commit or restore them before building evaluation data");

  const trees = await Promise.all(projects.map((project) => git(project, ["rev-parse", "HEAD:MemoryCore"])));
  const [baselineTreeRaw = "", nativeTreeRaw = ""] = trees;
  const baselineTree = baselineTreeRaw.trim();
  const nativeTree = nativeTreeRaw.trim();
  if (!baselineTree || !nativeTree) throw new Error("Cannot determine the MemoryCore source revision");
  if (baselineTree !== nativeTree) {
    throw new Error(`Baseline and Native MemoryCore source trees differ: ${baselineTree} != ${nativeTree}`);
  }

  const [coreConfig, coreEnvironment] = await Promise.all([
    readFile(resolve(config.paths.labRoot, "baseline", "config", "core.yaml"), "utf8"),
    readFile(resolve(config.paths.labRoot, "baseline", "secrets", "core.env"), "utf8"),
  ]);
  const runtimeDigest = createHash("sha256")
    .update(coreConfig.replace(/\r\n?/g, "\n"))
    .update("\0")
    .update(publicEnvironment(coreEnvironment))
    .digest("hex")
    .slice(0, 16);
  return `${baselineTree}:runtime-${runtimeDigest}`;
}
