import { resolve } from "node:path";

export type ParsedDataBuilderCommand = { configPath: string; check: boolean };

export function dataBuilderHelp(): string {
  return `Prepare one shared TencentDB Agent Memory dataset

Usage:
  npm run data:prepare -- --config FILE [--check]

Options:
  --config FILE  YAML file containing project, dataset, identity, and runtime paths
  --check        Validate inputs and show the release ID; does not import or replace data
`;
}

export function parseDataBuilderCommand(
  args: string[],
  cwd = process.env.INIT_CWD?.trim() || process.cwd(),
): ParsedDataBuilderCommand {
  let configPath: string | undefined;
  let check = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--check") {
      check = true;
      continue;
    }
    if (token === "--config" || token?.startsWith("--config=")) {
      if (configPath !== undefined) throw new Error("--config may only be supplied once");
      const inline = token.startsWith("--config=") ? token.slice("--config=".length) : undefined;
      const value = inline ?? args[++index];
      if (!value || value.startsWith("--")) throw new Error("Missing required --config");
      configPath = resolve(cwd, value);
      continue;
    }
    if (token?.startsWith("--")) throw new Error(`Unknown option ${token}`);
    throw new Error(`Unexpected argument: ${token ?? ""}`);
  }
  if (!configPath) throw new Error("Missing required --config");
  return { configPath, check };
}
