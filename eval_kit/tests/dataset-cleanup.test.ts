import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { loadDataset } from "../runner/dataset-loader.js";
import { discoverMemorySessions } from "../importers/memories/importer.js";
import { isolateSeedSessions, resolveSessionQuery } from "../pipeline/inputs.js";
import { createDefaultNativeProxyToolRegistry } from "../dataset/assets/memory_096_memory-proxy-evaluation/MemoryProxy/src/native-proxy-tools/tool-registry.js";

const root=resolve(import.meta.dirname,"../dataset");

it("历史读取任务传入的 ID 确实属于本题实际导入会话，不改静态标签", async () => {
  const {cases}=await loadDataset(resolve(root,"tasks/tool_call_eval_v1.jsonl"));
  const sessions=await discoverMemorySessions(resolve(root,"memories"));
  const history=cases.filter(c=>c.allowed_first_tools?.includes("tdai_conversation_query"));
  expect(history.length).toBeGreaterThan(0);
  for(const task of history){
    const mapping=isolateSeedSessions(sessions.filter(s=>task.source_memory_sessions?.includes(s.sessionId)),"test-run","task-01");
    const query=resolveSessionQuery(task.query,mapping);
    expect(query).not.toBe(task.query);
    for(const s of mapping) if(task.query.includes(s.source_session_id)){
      expect(query).toContain(s.session_id);
      expect(query).not.toContain('`'+s.source_session_id+'`');
    }
  }
});

it("补充的 Registry 能独立提供定义和参数校验，不依赖宿主服务", () => {
  const registry=createDefaultNativeProxyToolRegistry();
  const tools=registry.visibleFor({memoryEnabled:true,chatMemory:true,skillEnabled:true,skillCapability:true,allowSkillWrite:false});
  expect(tools).toHaveLength(10);
  expect(registry.require("tdai_memory_search").validate({query:"日志 格式"}).ok).toBe(true);
  expect(registry.require("skill_view").validate({} ).ok).toBe(false);
  for(const tool of tools) expect(tool.inputSchema.type).toBe("object");
});

it("Bridge 素材提供缺失输入而不附带评分答案，锁定镜像不是 latest", async () => {
  const samples=JSON.parse(await readFile(resolve(root,"assets/memory_097_memory-proxy-evaluation/fixtures/bridge-requests.json"),"utf8"));
  expect(samples.map((s:{command:string})=>s.command.match(/\/memory-bridge\/v3\/([^ ]+)/)?.[1]))
    .toEqual(["atomic/query","scenario/ls","scenario/read","atomic/search"]);
  expect(samples.every((s:object)=>Object.keys(s).length===1)).toBe(true);
  const lock=await readFile(resolve(root,"assets/memory_064_docker-linux-ops/ops/images.lock"),"utf8");
  expect(lock.trim()).toMatch(/^service-python=python:\d+\.\d+\.\d+-slim-bookworm$/);
});
