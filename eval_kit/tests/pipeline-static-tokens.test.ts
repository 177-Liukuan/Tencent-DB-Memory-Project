import { expect, it } from "vitest";
import { selectInjectedGeneration } from "../pipeline/static-tokens.js";
it("Baseline 使用 Langfuse 的消息数组，Native 必须找到实际带 Schema 的输入", () => {
  const base = {type:"GENERATION",startTime:"2026-09-05T00:00:01Z",metadata:{protocol:"anthropic",tools_len:6},
    input:JSON.stringify([{role:"system",content:"<skill_tools>说明</skill_tools>"},{role:"user",content:"问题"}])};
  const native = {...base,startTime:"2026-09-05T00:00:02Z",input:JSON.stringify({system:"说明",messages:[],tools:[{name:"skill_view",input_schema:{type:"object"}}]})};
  expect(selectInjectedGeneration([base,native],"baseline")).toBe(base);
  expect(selectInjectedGeneration([base,native],"native")).toBe(native);
  expect(()=>selectInjectedGeneration([base],"native")).toThrow("Schema");
});
