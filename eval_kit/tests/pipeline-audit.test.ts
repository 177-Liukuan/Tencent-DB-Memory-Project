import { expect, it } from "vitest";
import { inspectClientToolCalls } from "../pipeline/audit.js";
it("检查客户端实际 Tool Call，不把回答中提到工具名称误报为调用暴露", () => {
  const output = [{type:"assistant",message:{content:[{type:"text",text:"已用 tdai_memory_search 查询"},{type:"tool_use",id:"read",name:"Read"}]}}];
  expect(inspectClientToolCalls(output,["hidden"])).toEqual({client_tool_calls:1,native_tool_calls:[],native_call_ids:[]});
  output[0]!.message.content.push({type:"tool_use",id:"hidden",name:"tdai_memory_search"});
  expect(inspectClientToolCalls(output,["hidden"]).native_call_ids).toEqual(["hidden"]);
  expect(inspectClientToolCalls(output,["hidden"]).native_tool_calls).toEqual(["tdai_memory_search"]);
});
