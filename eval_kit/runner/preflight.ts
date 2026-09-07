import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { promisify } from "node:util";

import type { EvalConfig } from "./config.js";
import { parseEnvFile } from "./config.js";

const execFileAsync = promisify(execFile);

async function command(binary: string, args: string[] = [], cwd?: string): Promise<string> {
  const result = await execFileAsync(binary, args, { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  return result.stdout.trim();
}

async function waitForCommand(binary: string, args: string[], timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  do {
    try {
      return await command(binary, args);
    } catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  } while (true);
  throw lastError instanceof Error ? lastError : new Error(`Command did not become ready: ${binary}`);
}

async function git(path: string, args: string[]): Promise<string> {
  return command("git", ["-C", path, ...args]);
}

export type PreflightResult = {
  commits: { root: string; baseline: string; native: string; lab: string };
  versions: { node: string; claude: string; tokenizer: string };
  content_hashes?: Record<string, string>;
  worktrees?: Record<string, { branch: string | null; dirty: boolean; status_sha256: string }>;
};

async function worktreeState(path: string): Promise<{ branch: string | null; dirty: boolean; status_sha256: string }> {
  const [branch, status] = await Promise.all([
    git(path, ["branch", "--show-current"]),
    git(path, ["status", "--porcelain=v1", "--untracked-files=all"]),
  ]);
  return {
    branch: branch || null,
    dirty: status.length > 0,
    status_sha256: createHash("sha256").update(status).digest("hex"),
  };
}

export async function runPreflight(config: EvalConfig): Promise<PreflightResult> {
  await waitForCommand(config.lab.health_check, [], 60_000);
  await command(config.lab.preflight, ["baseline"]);
  await command(config.lab.preflight, ["native"]);
  const [baselineCommit, nativeCommit, rootCommit, labCommit, nativeBranch, claudeVersion] = await Promise.all([
    git(config.variants.baseline.repo_path, ["rev-parse", "HEAD"]),
    git(config.variants.native.repo_path, ["rev-parse", "HEAD"]),
    git(config.root_repo ?? config.variants.native.repo_path, ["rev-parse", "HEAD"]),
    git(config.lab.root, ["rev-parse", "HEAD"]),
    git(config.variants.native.repo_path, ["branch", "--show-current"]),
    command(config.claude.binary, ["--version"]),
  ]);
  if (config.variants.baseline.expected_commit && baselineCommit !== config.variants.baseline.expected_commit) {
    throw new Error(`Baseline commit mismatch: expected ${config.variants.baseline.expected_commit}, found ${baselineCommit}`);
  }
  if (config.variants.native.expected_branch && nativeBranch !== config.variants.native.expected_branch) {
    throw new Error(`Native branch mismatch: expected ${config.variants.native.expected_branch}, found ${nativeBranch}`);
  }
  const repositories: Array<[string, string]> = [
    ["root", config.root_repo ?? config.variants.native.repo_path],
    ["baseline", config.variants.baseline.repo_path],
    ["native", config.variants.native.repo_path],
    ["lab", config.lab.root],
  ];
  const worktrees = Object.fromEntries(await Promise.all(
    repositories.map(async ([name, path]) => [name, await worktreeState(path)] as const),
  ));
  if (worktrees.baseline?.dirty) throw new Error("Baseline worktree must be clean for a reproducible evaluation");
  const baselineEnv = parseEnvFile(await readFile(config.variants.baseline.env_file, "utf8"));
  const nativeEnv = parseEnvFile(await readFile(config.variants.native.env_file, "utf8"));
  const baselineModel = baselineEnv.ANTHROPIC_MODEL;
  const nativeModel = nativeEnv.ANTHROPIC_MODEL;
  if (!baselineModel || baselineModel !== nativeModel || baselineModel !== config.model.name) {
    throw new Error(`Model preflight mismatch: config=${config.model.name}, baseline=${baselineModel ?? "missing"}, native=${nativeModel ?? "missing"}`);
  }
  const manifest = JSON.parse(await readFile(config.lab.seed_manifest, "utf8")) as Record<string, unknown>;
  const manifestId = (section: string): string | null => {
    const value = manifest[section];
    return value && typeof value === "object" && typeof (value as Record<string, unknown>).id === "string"
      ? (value as Record<string, unknown>).id as string
      : null;
  };
  const identityChecks: Array<[string, string | null, string]> = [
    ["service_id", manifestId("instance"), config.identity.service_id],
    ["team_id", manifestId("team"), config.identity.team_id],
    ["agent_id", manifestId("agent"), config.identity.agent_id],
    ["task_id", manifestId("task"), config.identity.task_id],
  ];
  for (const [field, assetValue, configured] of identityChecks) {
    if (assetValue !== configured) throw new Error(`Identity preflight mismatch for ${field}: config=${configured}, asset=${assetValue ?? "missing"}`);
  }
  for (const path of [config.variants.baseline.auth_key_file, config.variants.native.auth_key_file]) {
    const mode = (await stat(path)).mode & 0o777;
    if (mode !== 0o600) throw new Error(`Credential file must be mode 600: ${path}`);
    if (!(await readFile(path, "utf8")).trim()) throw new Error(`Credential file must not be empty: ${path}`);
  }
  let langfusePublicKey = config.langfuse.public_key;
  let langfuseSecretKey = config.langfuse.secret_key;
  if (config.langfuse.credentials_file) {
    const credentials = parseEnvFile(await readFile(config.langfuse.credentials_file, "utf8"));
    langfusePublicKey ??= credentials.LANGFUSE_PUBLIC_KEY ?? credentials.LANGFUSE_INIT_PROJECT_PUBLIC_KEY;
    langfuseSecretKey ??= credentials.LANGFUSE_SECRET_KEY ?? credentials.LANGFUSE_INIT_PROJECT_SECRET_KEY;
  }
  if (!langfusePublicKey || !langfuseSecretKey) throw new Error("Langfuse credentials are missing");
  const contentHashes: Record<string, string> = {};
  for (const path of config.content_sources ?? []) {
    contentHashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
  }
  let tokenizerVersion = "unknown";
  try {
    const packagePath = new URL("../node_modules/js-tiktoken/package.json", import.meta.url);
    tokenizerVersion = (JSON.parse(await readFile(packagePath, "utf8")) as { version?: string }).version ?? "unknown";
  } catch { /* package exports may hide package.json */ }
  return {
    commits: { root: rootCommit, baseline: baselineCommit, native: nativeCommit, lab: labCommit },
    versions: { node: process.version, claude: claudeVersion, tokenizer: tokenizerVersion },
    content_hashes: contentHashes,
    worktrees,
  };
}

export async function restoreSeed(config: EvalConfig): Promise<{ backup_path: string | null; output: string }> {
  const output = await command(config.lab.restore_seed);
  const retained = output.match(/Previous state retained at:\s*(\/\S+)/iu)?.[1] ?? null;
  await waitForCommand(config.lab.health_check, [], 60_000);
  await command(config.lab.preflight, ["baseline"]);
  await command(config.lab.preflight, ["native"]);
  return { backup_path: retained, output };
}
