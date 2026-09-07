import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { MemoryConflictMode, MemoryImportTarget } from "./importer.js";

type Environment = Record<string, string | undefined>;
type ParsedArgs = { values: Map<string, string>; flags: Set<string> };

export type ParsedMemoryImportCommand = {
  targets: MemoryImportTarget[];
  options: { directory: string; onConflict: MemoryConflictMode; dryRun: boolean };
};

export function defaultMemoryImportLabRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../../tencentdb-memory-lab");
}

function parseArgs(args: string[]): ParsedArgs {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith("--")) throw new Error(`Unexpected argument: ${token ?? ""}`);
    const equals = token.indexOf("=");
    const key = equals > 2 ? token.slice(2, equals) : token.slice(2);
    if (values.has(key) || flags.has(key)) throw new Error(`--${key} may only be supplied once`);
    if (equals > 2) {
      values.set(key, token.slice(equals + 1));
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(key, next);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return { values, flags };
}

function required(parsed: ParsedArgs, key: string): string {
  const value = parsed.values.get(key)?.trim();
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

async function credential(
  variant: "baseline" | "native",
  parsed: ParsedArgs,
  env: Environment,
  labRoot: string,
): Promise<string> {
  const upper = variant.toUpperCase();
  const fromEnvironment = (
    env[`TDAI_${upper}_MEMORY_API_KEY`]
    ?? env[`TDAI_${upper}_SKILL_API_KEY`]
  )?.trim();
  if (fromEnvironment) return fromEnvironment;
  const explicitFile = parsed.values.get(`${variant}-api-key-file`);
  const path = explicitFile
    ? resolve(explicitFile)
    : resolve(labRoot, variant, "secrets", "core-gateway.key");
  const value = await readFile(path, "utf8").then((raw) => raw.trim()).catch((error: unknown) => {
    throw new Error(
      `Cannot read ${variant} API key file ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
  if (!value) throw new Error(`${variant} API key file is empty: ${path}`);
  return value;
}

export async function parseMemoryImportCommand(
  args: string[],
  env: Environment = process.env,
): Promise<ParsedMemoryImportCommand> {
  const parsed = parseArgs(args);
  const variant = parsed.values.get("variant") ?? "native";
  if (variant !== "baseline" && variant !== "native" && variant !== "both") {
    throw new Error("--variant must be baseline, native, or both");
  }
  const onConflict = parsed.values.get("on-conflict") ?? "error";
  if (onConflict !== "error" && onConflict !== "skip" && onConflict !== "append") {
    throw new Error("--on-conflict must be error, skip, or append");
  }
  const directory = required(parsed, "directory");
  const userId = required(parsed, "user-id");
  const teamId = required(parsed, "team-id");
  const agentId = required(parsed, "agent-id");
  const serviceId = parsed.values.get("service-id")?.trim() || "rhino-ab";
  const defaultLabRoot = defaultMemoryImportLabRoot();
  const labRoot = resolve(parsed.values.get("lab-root") ?? env.TDAI_LAB_ROOT ?? defaultLabRoot);
  const variants: Array<"baseline" | "native"> = variant === "both" ? ["baseline", "native"] : [variant];
  const targets: MemoryImportTarget[] = [];
  for (const selected of variants) {
    const upper = selected.toUpperCase();
    const defaultUrl = selected === "native" ? "http://127.0.0.1:18420" : "http://127.0.0.1:8420";
    const baseUrl = (
      parsed.values.get(`${selected}-url`)
      ?? env[`TDAI_${upper}_CORE_URL`]
      ?? defaultUrl
    ).replace(/\/$/, "");
    targets.push({
      label: selected,
      baseUrl,
      apiKey: await credential(selected, parsed, env, labRoot),
      serviceId,
      userId,
      teamId,
      agentId,
    });
  }
  return {
    targets,
    options: { directory, onConflict, dryRun: parsed.flags.has("dry-run") },
  };
}

export function memoryImportHelp(): string {
  return `Batch import L0 conversations into TencentDB Agent Memory

Usage:
  npm run memories:import -- --variant native|baseline|both --directory DIR \\
    --user-id USER --team-id TEAM --agent-id AGENT [options]

Input:
  Recursively reads .json and .jsonl files. Each session object contains:
  { "session_id": "optional", "messages": [{ "role": "user|assistant", "content": "..." }] }

Options:
  --service-id ID                  Default: rhino-ab
  --on-conflict error|skip|append  Default: error
  --dry-run                        Validate and check existing sessions without writing
  --lab-root DIR                   Lab root containing <variant>/secrets/core-gateway.key
  --native-url URL                 Default: http://127.0.0.1:18420
  --baseline-url URL               Default: http://127.0.0.1:8420
  --native-api-key-file FILE       Override native credential file
  --baseline-api-key-file FILE     Override baseline credential file

Environment overrides:
  TDAI_LAB_ROOT, TDAI_NATIVE_CORE_URL, TDAI_BASELINE_CORE_URL,
  TDAI_NATIVE_MEMORY_API_KEY, TDAI_BASELINE_MEMORY_API_KEY
`;
}
