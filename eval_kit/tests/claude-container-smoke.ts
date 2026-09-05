// 手动集成检查：真实 Claude CLI + 真实容器，本地固定响应只验证配置传递和进程终止。
// 不请求真实模型、不准备 Agent，不把这里的模拟事件混入九条任务的评测结果。
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { runClaudeClient } from "../runner/client.js";
import { secureWrite, secureWriteJson } from "../lib/fs.js";

const binary = process.env.CLAUDE_BINARY;
const image = process.env.EVAL_CLIENT_IMAGE;
const output = process.argv[2];
if (!binary || !image || !output) throw new Error("需要 CLAUDE_BINARY、EVAL_CLIENT_IMAGE 和输出 JSON 路径");
const directory = await mkdtemp(join(tmpdir(), "eval-cli-smoke-"));
const observation = join(directory, "observations.jsonl");
let mode: "answer" | "stop" = "answer";
let session = "";
const requests: Array<{ mode: string; thinking: unknown; model: unknown }> = [];
const server = createServer(async (request, response) => {
  if (request.url?.startsWith("/skill/")) {
    const tool = request.url.endsWith("view") ? "skill_view" : "skill_files_read";
    await appendFile(observation, JSON.stringify({ event_id: randomUUID(), session_id: session,
      tool_name: tool, tool_family: "skill", call_id: null, timestamp: new Date().toISOString() }) + "\n");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }
  let raw = "";
  for await (const chunk of request) raw += chunk;
  if (!request.url?.includes("/messages")) { response.end("{}"); return; }
  const body = JSON.parse(raw);
  requests.push({ mode, thinking: body.thinking ?? null, model: body.model });
  const block = mode === "answer" ? { type: "text", text: "OK" } : {
    type: "tool_use", id: "smoke_call", name: "Bash", input: {
      command: `curl -fsS http://127.0.0.1:${port}/skill/view && curl -fsS http://127.0.0.1:${port}/skill/files && sleep 60`,
    },
  };
  const stopReason = mode === "answer" ? "end_turn" : "tool_use";
  response.writeHead(200, { "content-type": "text/event-stream" });
  const send = (event: string, data: unknown) => response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  send("message_start", { type: "message_start", message: { id: "msg_smoke", type: "message", role: "assistant",
    model: body.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
  send("content_block_start", { type: "content_block_start", index: 0,
    content_block: mode === "answer" ? { type: "text", text: "" } : { ...block, input: {} } });
  send("content_block_delta", { type: "content_block_delta", index: 0, delta: mode === "answer"
    ? { type: "text_delta", text: "OK" }
    : { type: "input_json_delta", partial_json: JSON.stringify(block.input) } });
  send("content_block_stop", { type: "content_block_stop", index: 0 });
  send("message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 1 } });
  send("message_stop", { type: "message_stop" });
  response.end();
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
await secureWrite(join(directory, "env"), "");
await secureWrite(join(directory, "key"), "local-smoke-test-not-a-real-key");
const results: unknown[] = [];
try {
  for (const current of ["answer", "stop"] as const) {
    mode = current; session = randomUUID();
    const workspace = join(directory, current, "workspace"), settings = join(directory, current, "settings");
    await mkdir(workspace, { recursive: true }); await mkdir(settings, { recursive: true });
    const result = await runClaudeClient({ binary, variant: "baseline", sessionId: session, workDirectory: workspace,
      claudeConfigDirectory: settings, envFile: join(directory, "env"), authKeyFile: join(directory, "key"),
      baseUrl: `http://127.0.0.1:${port}`, identity: { service_id: "test", team_id: "test", agent_id: "test", task_id: "test" },
      timeoutMs: 30_000, streamPath: join(directory, current, "cli.jsonl"),
      testCase: { schema_version: 1, case_id: "smoke", suite: "smoke", query: "只回复 OK。", should_call: false, expected_tools: [] },
      evaluation: { model: "deepseek-v4-flash[1m]", allowBash: true, image },
      ...(current === "stop" ? { observationStop: { file: observation, tools: ["skill_view", "skill_files_read"] } } : {}),
    });
    results.push({ mode, completed: !!result.completedAt, stopped_on_observation: result.stoppedOnObservation,
      timed_out: result.timedOut, elapsed_ms: Date.parse(result.endedAt) - Date.parse(result.startedAt), stderr: result.stderr });
    assert.equal(result.timedOut, false);
    if (current === "answer") assert.ok(result.completedAt);
    else { assert.equal(result.stoppedOnObservation, true); assert.equal(result.completedAt, undefined); }
  }
  assert.ok(requests.length > 0);
  // SDK 可能给辅助请求省略 thinking；保留捕获事实，不能把 CLI 设置等同于上游已关闭。
  const explicitDisabled = requests.every(request => JSON.stringify(request.thinking) === JSON.stringify({ type: "disabled" }));
  await secureWriteJson(output, { passed: true, real_cli: true, real_container: true, model_service: "local test fixture",
    business_evaluation: false, explicit_thinking_disabled_on_all_requests: explicitDisabled, requests, results, directory });
  console.log(JSON.stringify({ passed: true, explicit_thinking_disabled_on_all_requests: explicitDisabled, requests, results, output }));
} finally { server.closeAllConnections(); server.close(); }
