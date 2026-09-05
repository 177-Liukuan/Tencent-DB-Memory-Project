#!/usr/bin/env node
import { resolve } from "node:path";

import { serve } from "@hono/node-server";

import type { Variant } from "./types.js";
import { dataBuilderHelp, parseDataBuilderCommand } from "./data-preparation/command.js";
import { prepareDataBuilder } from "./data-preparation/prepare.js";
import { parseMemoryImportCommand, memoryImportHelp } from "./importers/memories/command.js";
import { importMemoryDirectory } from "./importers/memories/importer.js";
import { runExperiment, scoreExperiment } from "./runner/runner.js";
import { runObservationExperiment, scoreObservationExperiment } from "./bridge-eval/runner.js";
import { runPilotPipeline } from "./pipeline/run.js";
import { parseSkillImportCommand, skillImportHelp } from "./importers/skills/command.js";
import { importSkillDirectory } from "./importers/skills/importer.js";
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
  return `TencentDB Agent Memory Eval Kit

Usage:
  npm run pipeline -- --config configs/pilot.example.yaml
  npm run run -- --config configs/bridge-observation.example.yaml
  npm run legacy:run -- --config configs/experiments/smoke.yaml [--reset-assets|--resume] [--case ID] [--variant baseline|native]
  npm run score -- --experiment results/<experiment_id>
  npm run viewer -- --results results [--port 4173]
  npm run skills:import -- --variant native|baseline|both --directory DIR --user-id USER --team-id TEAM --agent-id AGENT
  npm run memories:import -- --variant native|baseline|both --directory DIR --user-id USER --team-id TEAM --agent-id AGENT
  npm run data:prepare -- --config FILE [--check]
`;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(help());
    return;
  }
  if (args.includes("--help")) {
    if (command === "skills") process.stdout.write(skillImportHelp());
    else if (command === "memories") process.stdout.write(memoryImportHelp());
    else if (command === "data") process.stdout.write(dataBuilderHelp());
    else process.stdout.write(help());
    return;
  }
  if (command === "pipeline") {
    const parsed = parse(args);
    const result = await runPilotPipeline(resolve(one(parsed,"config",true)!));
    process.stdout.write(JSON.stringify({experimentDirectory:result.experimentDirectory,summary:result.summary},null,2) + "\n");
    return;
  }
  if (command === "skills") {
    const [subcommand, ...skillArgs] = args;
    if (subcommand !== "import") throw new Error(`Unknown skills command: ${subcommand ?? ""}\n\n${skillImportHelp()}`);
    const parsedSkillImport = await parseSkillImportCommand(skillArgs);
    const results = [];
    for (const target of parsedSkillImport.targets) {
      results.push(await importSkillDirectory({ ...parsedSkillImport.options, target }));
    }
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
    return;
  }
  if (command === "memories") {
    const [subcommand, ...memoryArgs] = args;
    if (subcommand !== "import") throw new Error(`Unknown memories command: ${subcommand ?? ""}\n\n${memoryImportHelp()}`);
    const parsedMemoryImport = await parseMemoryImportCommand(memoryArgs);
    const results = [];
    for (const target of parsedMemoryImport.targets) {
      results.push(await importMemoryDirectory({ ...parsedMemoryImport.options, target }));
    }
    process.stdout.write(`${JSON.stringify({ results }, null, 2)}\n`);
    return;
  }
  if (command === "data") {
    const [subcommand, ...dataArgs] = args;
    if (subcommand !== "prepare") throw new Error(`Unknown data command: ${subcommand ?? ""}\n\n${dataBuilderHelp()}`);
    const parsedDataBuilder = parseDataBuilderCommand(dataArgs);
    const result = await prepareDataBuilder(parsedDataBuilder.configPath, {
      check: parsedDataBuilder.check,
      progress: (message) => process.stderr.write(`[data-builder] ${message}\n`),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const parsed = parse(args);
  if (command === "run") {
    if (parsed.flags.size || [...parsed.values.keys()].some(k => k !== "config")) throw new Error("Bridge evaluation accepts only --config; select runs in the prepared manifest");
    const result = await runObservationExperiment(resolve(one(parsed, "config", true)!));
    process.stdout.write(JSON.stringify({ experiment: result.experimentDirectory, runs: result.runs.length, summary: result.summary }, null, 2) + "\n");
    if (result.runs.some(r => !r.observation_valid)) process.exitCode = 1;
    return;
  }
  if (command === "legacy-run") {
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
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const saved = JSON.parse(await readFile(join(resolve(experiment), "summary.json"), "utf8")) as { schema_version?: number };
    const summary = saved.schema_version === 2 ? await scoreObservationExperiment(resolve(experiment)) : await scoreExperiment(resolve(experiment));
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
  process.stderr.write(`eval-kit: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
