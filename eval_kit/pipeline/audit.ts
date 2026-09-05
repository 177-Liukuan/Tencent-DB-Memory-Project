import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MANAGED_TOOL_NAMES } from "../recorder/tool-registry.js";
import { readJsonl } from "../lib/fs.js";
import { verifySessionInitialization } from "../bridge-eval/session-initialization.js";
import { normalizeBridgeEvents } from "../bridge-eval/observations.js";
import type { PreparedRun } from "../bridge-eval/config.js";

export function inspectClientToolCalls(events:Record<string,unknown>[],hiddenIds:string[]) {
  const calls = events.filter(e=>e.type === "assistant").flatMap(e=>{
    const content = (e.message as {content?:unknown[]})?.content;
    return Array.isArray(content) ? content.filter(b=>b && typeof b === "object" && (b as {type?:string}).type === "tool_use") as Array<{id:string;name:string}> : [];
  });
  return {client_tool_calls:calls.length,native_tool_calls:calls.filter(c=>MANAGED_TOOL_NAMES.has(c.name)).map(c=>c.name),
    native_call_ids:calls.filter(c=>hiddenIds.includes(c.id)).map(c=>c.id)};
}

// 独立读回已落盘的结果，核对文件与身份对应；不向模型发送额外请求，也不修改业务状态。
export async function auditPilotResults(directory:string,labRoot:string) {
  const manifest = JSON.parse(await readFile(join(directory,"manifest.json"),"utf8")) as PreparedRun[];
  const rows = []; const issues:string[] = []; const sessions = new Set<string>(); const users = new Set<string>();
  for (const prepared of manifest) {
    const run = JSON.parse(await readFile(join(directory,"runs",prepared.run_id+".json"),"utf8"));
    const raw = join(directory,"raw",prepared.run_id);
    const recorded = JSON.parse(await readFile(join(raw,"bridge-events.json"),"utf8"));
    const calls = normalizeBridgeEvents(recorded,run.session_id,prepared.variant)
      .filter(call=>!run.observation_stopped_at || Date.parse(call.timestamp)<=Date.parse(run.observation_stopped_at));
    const output = inspectClientToolCalls(await readJsonl(join(raw,"client-stream.jsonl")),calls.flatMap(c=>c.call_id?[c.call_id]:[]));
    if (JSON.stringify(calls.map(c=>c.tool_name)) !== JSON.stringify(run.actual_tools)) issues.push(prepared.run_id+": 原始事件与统计结果不同");
    if (sessions.has(run.session_id)) issues.push(prepared.run_id+": Session 被复用");
    sessions.add(run.session_id);
    if (prepared.variant === "native" && (output.native_tool_calls.length || output.native_call_ids.length)) issues.push(prepared.run_id+": Native 调用出现在客户端");
    if (calls.some(c=>Date.parse(c.timestamp)<Date.parse(run.started_at)||Date.parse(c.timestamp)>Date.parse(run.ended_at))) issues.push(prepared.run_id+": 事件时间不属于本次运行");
    let initialization;
    try {
      initialization = verifySessionInitialization(join(labRoot,prepared.variant,"data/proxy/proxy.db"),run.session_id,prepared.identity);
      const key = prepared.variant+":"+initialization.user_id;
      if (users.has(key)) issues.push(prepared.run_id+": 用户被其他 Task 复用");
      users.add(key);
    } catch(error) {issues.push(prepared.run_id+": "+String(error));}
    rows.push({run_id:prepared.run_id,session_id:run.session_id,initialization,raw_events:recorded.length,observed_calls:calls.length,...output});
  }
  return {checked_runs:rows.length,distinct_sessions:sessions.size,distinct_variant_users:users.size,issues,rows};
}
