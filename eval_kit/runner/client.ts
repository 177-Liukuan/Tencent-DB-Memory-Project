import { spawn, execFile } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, readFile, realpath } from "node:fs/promises";
import { containerCommand } from "./container-client.js";

import type { EvalCase, Variant } from "../types.js";
import { parseEnvFile } from "./config.js";
import { secureWriteJson } from "../lib/fs.js";
import { join } from "node:path";

export type ClientRunInput = {
  /** 新评测入口必须启用 Claude 的正常 Hooks；旧实验调用方式保持兼容。 */
  evaluation?: { model: string; allowBash?: boolean; image?: string };
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
  observationStop?: {file:string;tools:string[]};
};

export type ClientRunResult = {
  events: Record<string, unknown>[];
  exitCode: number | null;
  timedOut: boolean;
  startedAt: string;
  endedAt: string;
  completedAt?: string;
  ttftMs: number | null;
  stderr: string;
  stoppedOnObservation?:boolean;
  observationStoppedAt?:string;
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
    // 两组关闭 CLI 思考设置；自定义上游是否收到 disabled 仍需按实际请求核对。
    MAX_THINKING_TOKENS: "0",
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
  };
  delete env.ANTHROPIC_API_KEY;
  if (input.evaluation) {
    // 每次运行使用独立设置，既不读取用户项目设置，也不让 --bare 禁用 Native 的 Turn Hook。
    const hooks = input.variant === "native" ? Object.fromEntries(
      ["UserPromptSubmit", "PreCompact", "PostCompact"].map(event => [event, [{ matcher: "", hooks: [{
        type: "http", url: input.baseUrl.replace(/\/$/, "") + "/hooks/claude-code/context",
        headers: { "x-api-key": authToken },
      }] }]]),
    ) : {};
    await secureWriteJson(join(input.claudeConfigDirectory, "settings.json"), { hooks, alwaysThinkingEnabled: false });
    env.ANTHROPIC_MODEL = input.evaluation.model;
  }
  const args = [
    ...(input.evaluation ? ["--setting-sources", "user", "--model", input.evaluation.model] : ["--bare"]),
    "--no-session-persistence",
    "--output-format", "stream-json",
    "--verbose",
    "--tools", input.evaluation ? "Bash,Read,Write,Edit,Glob,Grep" : "Bash",
    // Coding 评测需要安装依赖和运行测试；由统一实验配置显式开启，两组保持相同权限。
    "--allowedTools", input.evaluation?.allowBash ? "Bash,Read,Write,Edit,Glob,Grep"
      : input.evaluation ? "Bash(curl *),Read,Write,Edit,Glob,Grep" : "Bash(curl *)",
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
  let completedAt: string | undefined;
  let timingBuffer = "";
  let stoppedOnObservation=false;
  let observationStoppedAt:string|undefined;
  const containerName = `tdai-eval-${input.sessionId}`;
  const launch = input.evaluation?.image ? containerCommand({image:input.evaluation.image,name:containerName,
    binary:await realpath(input.binary),workspace:input.workDirectory,settings:input.claudeConfigDirectory,args}) : {command:input.binary,args};
  const child = spawn(launch.command, launch.args, {
    cwd: input.workDirectory,
    env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk: Buffer) => {
    if (firstOutputMs === null) firstOutputMs = Date.now() - startedMs;
    raw += chunk.toString("utf8");
    output.write(chunk);
    timingBuffer += chunk.toString("utf8");
    const lines = timingBuffer.split("\n");
    timingBuffer = lines.pop() ?? "";
    for (const line of [...lines, timingBuffer]) {
      try {
        const event = JSON.parse(line) as Record<string, unknown>;
        // 用户在最终 result 到达时已收到完整回答，不把后续进程收尾计入等待时间。
        if (event.type === "result" && event.is_error !== true) completedAt ??= new Date().toISOString();
      } catch { /* stdout 中的非 JSON 文本不代表回答完成 */ }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 32_768) stderr += chunk.toString("utf8").slice(0, 32_768 - stderr.length);
  });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    let settled = false;
    const stop = () => {
      if (input.evaluation?.image) execFile("docker",["rm","-f",containerName],()=>{});
      if (child.pid) killProcessGroup(child.pid,"SIGTERM");
      setTimeout(()=>{if (child.exitCode===null && child.pid) killProcessGroup(child.pid,"SIGKILL");},2000).unref();
    };
    let checking=false;
    const observationTimer=input.observationStop ? setInterval(async () => {
      if (settled || checking || stoppedOnObservation) return;
      checking=true;
      try {
        const content=await readFile(input.observationStop!.file,"utf8");
        if (settled) return;
        // 只读完整行；文件末尾可能正在追加，最终计数仍由严格事件解析器检查。
        const rows=content.slice(0,content.lastIndexOf("\n")+1).split("\n").filter(Boolean).map(line=>JSON.parse(line));
        const names=rows.map(row=>row.tool_name);
        const tools=input.observationStop!.tools;
        if (names.length && tools.every(tool=>names.includes(tool))) {
          stoppedOnObservation=true;observationStoppedAt=new Date().toISOString();stop();
        }
      } catch(error) {if ((error as NodeJS.ErrnoException).code!=="ENOENT") stderr+="\nObservation stop read failed; final validation required.";}
      finally {checking=false;}
    },250) : undefined;
    const finish = (value: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(observationTimer);
      resolve(value);
    };
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(observationTimer);
      reject(error);
    });
    // close 保证 stdout 已读完；exit 可能早于最后一段数据到达。
    child.once("close", (code) => finish(code));
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, input.timeoutMs);
  });
  if (input.evaluation?.image) await new Promise<void>(resolve=>execFile("docker",["rm","-f",containerName],()=>resolve()));
  await new Promise<void>((resolve, reject) => output.end((error?: Error | null) => error ? reject(error) : resolve()));
  await chmod(input.streamPath, 0o600);
  const events = parseEvents(raw);
  return {
    events,
    exitCode,
    timedOut,
    startedAt,
    endedAt: new Date().toISOString(),
    ...(completedAt ? { completedAt } : {}),
    ttftMs: timeToFirstAssistantMs(events, startedAt, firstOutputMs),
    stderr,
    stoppedOnObservation,
    ...(observationStoppedAt ? {observationStoppedAt} : {}),
  };
}
