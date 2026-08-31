#!/usr/bin/env node
import { resolve } from "node:path";

import { serve } from "@hono/node-server";

import type { Variant } from "./types.js";
import { runExperiment, scoreExperiment } from "./runner/runner.js";
import { createViewerApp } from "./viewer/server.js";

type Parsed = { values: Map<string, string[]>; flags: Set<string> };

function parse(args: string[]): Parsed {
  const values = new Map<string, string[]>();
  const flags = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (!token?.startsWith("--")) throw new Error(`Unexpected argument: ${token ?? ""}`);
    const [rawKey, inline] = token.slice(2).split("=", 2);
    const key = rawKey ?? "";
    if (inline !== undefined) {
      values.set(key, [...(values.get(key) ?? []), inline]);
      continue;
    }
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      values.set(key, [...(values.get(key) ?? []), next]);
      index += 1;
    } else {
      flags.add(key);
    }
  }
  return { values, flags };
}

function one(parsed: Parsed, name: string, required = false): string | undefined {
  const values = parsed.values.get(name) ?? [];
  if (values.length > 1) throw new Error(`--${name} may only be supplied once`);
  if (required && !values[0]) throw new Error(`Missing required --${name}`);
  return values[0];
}

function help(): string {
  return `Native Proxy Tool evaluation harness

Usage:
  npm run run -- --config configs/smoke.yaml [--reset-assets|--resume] [--case ID] [--variant baseline|native]
  npm run score -- --experiment results/<experiment_id>
  npm run viewer -- --results results [--port 4173]
`;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(help());
    return;
  }
  if (args.includes("--help")) {
    process.stdout.write(help());
    return;
  }
  const parsed = parse(args);
  if (command === "run") {
    const config = one(parsed, "config", true) as string;
    const variant = one(parsed, "variant");
    if (variant && variant !== "baseline" && variant !== "native") throw new Error("--variant must be baseline or native");
    const caseIds = (parsed.values.get("case") ?? []).flatMap((value) => value.split(",")).filter(Boolean);
    const result = await runExperiment(resolve(config), {
      resetAssets: parsed.flags.has("reset-assets"),
      resume: parsed.flags.has("resume"),
      ...(caseIds.length > 0 ? { caseIds: new Set(caseIds) } : {}),
      ...(variant ? { variants: new Set([variant as Variant]) } : {}),
    });
    process.stdout.write(`${JSON.stringify({ experiment: result.experimentDirectory, runs: result.runs.length }, null, 2)}\n`);
    return;
  }
  if (command === "score") {
    const experiment = one(parsed, "experiment", true) as string;
    const summary = await scoreExperiment(resolve(experiment));
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  if (command === "viewer") {
    const results = resolve(one(parsed, "results") ?? "results");
    const port = Number(one(parsed, "port") ?? "4173");
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("--port must be an integer from 1 to 65535");
    const server = serve({ fetch: createViewerApp({ resultsRoot: results }).fetch, hostname: "127.0.0.1", port });
    process.stdout.write(`Case Viewer: http://127.0.0.1:${port}\n`);
    const close = (): void => {
      server.close(() => process.exit(0));
    };
    process.once("SIGINT", close);
    process.once("SIGTERM", close);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${help()}`);
}

main().catch((error) => {
  process.stderr.write(`eval: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
