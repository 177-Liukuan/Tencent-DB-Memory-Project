import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, readFile } from "node:fs/promises";

import type { EvalCase, Variant } from "../types.js";
import { parseEnvFile } from "./config.js";

export type ClientRunInput = {
  binary: string;
  variant: Variant;
  testCase: EvalCase;
  sessionId: string;
  workDirectory: string;
  claudeConfigDirectory: string;
  envFile: string;
  authKeyFile: string;
  baseUrl: string;
  identity: { service_id: string; team_id: string; agent_id: string; task_id: string };
  timeoutMs: number;
  streamPath: string;
};

export type ClientRunResult = {
  events: Record<string, unknown>[];
  exitCode: number | null;
  timedOut: boolean;
  startedAt: string;
  endedAt: string;
  ttftMs: number | null;
  stderr: string;
};

function parseEvents(raw: string): Record<string, unknown>[] {
  return raw.split(/\r?\n/u).flatMap((line) => {
    if (!line.trim()) return [];
    try {
      const parsed = JSON.parse(line);
      return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
    } catch {
      return [{ type: "client_parse_error", raw: line }];
    }
  });
}

export function timeToFirstAssistantMs(
  events: Record<string, unknown>[],
  startedAt: string,
  fallback: number | null,
): number | null {
  const result = events.find((event) => event.type === "result");
  for (const field of ["ttft_stream_ms", "ttft_ms"] as const) {
    const value = result?.[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  const startedMs = Date.parse(startedAt);
  for (const event of events) {
    if (event.type !== "assistant" || typeof event.timestamp !== "string") continue;
    const eventMs = Date.parse(event.timestamp);
    if (Number.isFinite(startedMs) && Number.isFinite(eventMs)) return Math.max(0, eventMs - startedMs);
  }
  return fallback;
}

function killProcessGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); } catch {
    try { process.kill(pid, signal); } catch { /* process already exited */ }
  }
}

export async function runClaudeClient(input: ClientRunInput): Promise<ClientRunResult> {
  const sourceEnv = parseEnvFile(await readFile(input.envFile, "utf8"));
  const authToken = (await readFile(input.authKeyFile, "utf8")).trim();
  const customHeaders = [
    `x-team-id: ${input.identity.team_id}`,
    `x-agent-id: ${input.identity.agent_id}`,
    `x-task-id: ${input.identity.task_id}`,
    `x-tdai-service-id: ${input.identity.service_id}`,
  ].join("\n");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...sourceEnv,
    ANTHROPIC_BASE_URL: input.baseUrl,
    ANTHROPIC_AUTH_TOKEN: authToken,
    ANTHROPIC_CUSTOM_HEADERS: customHeaders,
    CLAUDE_CONFIG_DIR: input.claudeConfigDirectory,
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  };
  delete env.ANTHROPIC_API_KEY;
  const args = [
    "--bare",
    "--no-session-persistence",
    "--output-format", "stream-json",
    "--verbose",
    "--tools", "Bash",
    "--allowedTools", "Bash(curl *)",
    "--session-id", input.sessionId,
    "--print",
    input.testCase.query,
  ];
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const output = createWriteStream(input.streamPath, { flags: "w", mode: 0o600 });
  let raw = "";
  let stderr = "";
  let firstOutputMs: number | null = null;
  let timedOut = false;
  const child = spawn(input.binary, args, {
    cwd: input.workDirectory,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (firstOutputMs === null) firstOutputMs = Date.now() - startedMs;
    raw += chunk.toString("utf8");
    output.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 32_768) stderr += chunk.toString("utf8").slice(0, 32_768 - stderr.length);
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    let settled = false;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => finish(code));
    const timeout = setTimeout(() => {
      timedOut = true;
      if (child.pid) killProcessGroup(child.pid, "SIGTERM");
      setTimeout(() => {
        if (child.exitCode === null && child.pid) killProcessGroup(child.pid, "SIGKILL");
      }, 2_000).unref();
    }, input.timeoutMs);
  });
  await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()));
  await chmod(input.streamPath, 0o600);
  const events = parseEvents(raw);
  return {
    events,
    exitCode,
    timedOut,
    startedAt,
    endedAt: new Date().toISOString(),
    ttftMs: timeToFirstAssistantMs(events, startedAt, firstOutputMs),
    stderr,
  };
}
