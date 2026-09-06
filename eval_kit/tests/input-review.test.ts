import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { captureInputReviews, reviewInjectedInput } from "../pipeline/input-review.js";
import { LangfuseClient } from "../recorder/langfuse-client.js";
import type { EvalCase } from "../types.js";

it("只保留动态 Memory 与候选顺序，完整命中不等同于语义判定", () => {
  const result = reviewInjectedInput({system:[{type:"text",text:'private transport header\n<available_skills>\n- beta: workflow\n- alpha: workflow\n</available_skills>\n<tdai_profile_memory><l3_core_memory>默认 37 条。</l3_core_memory></tdai_profile_memory>'}]},["alpha","beta"],["默认 37 条。","最多 137 条。"]);
  expect(result.candidate_order).toEqual(["beta","alpha"]);
  expect(result.memory).not.toContain("private transport header");
  expect(result.exact_target_matches).toEqual([true,false]);
  expect(result.review_required).toBe(true);
});

it("能读取 JSON 字符串输入；缺少动态内容不伪造已注入", () => {
  const result = reviewInjectedInput(JSON.stringify({system:"hello"}),["alpha"],["fact"]);
  expect(result.memory).toBe(""); expect(result.candidate_order).toEqual([]);
  expect(result.exact_target_matches).toEqual([false]);
});

it("Baseline 的 Langfuse 消息数组也能读取 system 内容，不把用户正文当作注入", () => {
  const result = reviewInjectedInput([
    {role:"system",content:"<available_skills>\n- beta: workflow\n- alpha: workflow\n</available_skills><tdai_profile_memory>默认 37 条。</tdai_profile_memory>"},
    {role:"user",content:"gamma <tdai_profile_memory>最多 137 条。</tdai_profile_memory>"},
  ],["alpha","beta","gamma"],["默认 37 条。","最多 137 条。"]);
  expect(result.candidate_order).toEqual(["beta","alpha"]);
  expect(result.exact_target_matches).toEqual([true,false]);
});

it("按完整 Skill 库核对实际目录，不能把使用说明中出现的名字当作已注入", () => {
  const result = reviewInjectedInput({system: "alpha is mentioned here; beta-long is another skill.\n<available_skills>\n- beta: workflow\n- gamma: workflow\n</available_skills>"}, ["alpha", "beta", "gamma"], []);
  expect(result.candidate_order).toEqual(["beta", "gamma"]);
  expect(result.missing_skills).toEqual(["alpha"]);
});

it.each([
  { name: "内容和顺序一致", listing: "- alpha: first\n- beta: second", status: "matched" },
  { name: "目录缺项", listing: "- alpha: first", status: "mismatch" },
  { name: "目录乱序", listing: "- beta: second\n- alpha: first", status: "mismatch" },
  { name: "同名但描述不同", listing: "- alpha: changed\n- beta: second", status: "mismatch" },
  { name: "缺少模型观测", listing: null, status: "unavailable" },
])("实际输入核对：$name", async ({listing,status}) => {
  const root = await mkdtemp(join(tmpdir(), "eval-input-review-"));
  try {
    for (const variant of ["baseline", "native"]) {
      await mkdir(join(root,variant,"secrets"),{recursive:true});
      await writeFile(join(root,variant,"secrets/proxy.yaml"),JSON.stringify({langfuse:{host:"http://localhost",publicKey:"test",secretKey:"test"}}));
    }
    await mkdir(join(root,"memories"));
    await writeFile(join(root,"memories/session.json"),JSON.stringify({session_id:"s",messages:[{role:"user",content:"fact"}]}));
    // 只替换远端观测读取；目录解析、请求选择和核对文件均走真实实现。
    vi.spyOn(LangfuseClient.prototype,"listObservations").mockImplementation(async ({sessionId}) => {
      if (sessionId==="native" && listing===null) return [];
      const catalog = sessionId==="native" ? listing : "- alpha: first\n- beta: second";
      const system = `<skill_tools>guide</skill_tools><available_skills>\n${catalog}\n</available_skills>`;
      return [{id:sessionId,traceId:"trace",type:"GENERATION",startTime:"2026-09-06T00:00:00Z",metadata:{protocol:"anthropic",tools_len:1},
        input:sessionId==="baseline" ? [{role:"system",content:system}] : {system,tools:[{name:"skill_view",input_schema:{type:"object"}}]}}];
    });
    const task:EvalCase = {schema_version:1,case_id:"task",suite:"main",query:"query",should_call:true,expected_tools:["skill_view"],candidate_skills:["alpha"]};
    await captureInputReviews(root,(["baseline","native"] as const).map(variant=>({run_id:variant,case_id:"task",variant,session_id:variant})),[task],join(root,"memories"),join(root,"review"),["alpha","beta"]);
    const report = JSON.parse(await readFile(join(root,"review/skill-catalog-check.json"),"utf8"));
    expect(report.expected_skills).toEqual(["alpha","beta"]);
    expect(report.checks).toMatchObject([{case_id:"task",status}]);
  } finally { vi.restoreAllMocks(); await rm(root,{recursive:true,force:true}); }
});
