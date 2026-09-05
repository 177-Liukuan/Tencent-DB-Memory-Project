import { expect, it } from "vitest";
import { reviewInjectedInput } from "../pipeline/input-review.js";

it("只保留动态 Memory 与候选顺序，完整命中不等同于语义判定", () => {
  const result = reviewInjectedInput({system:[{type:"text",text:'private transport header\n<skills>beta alpha</skills>\n<tdai_profile_memory><l3_core_memory>默认 37 条。</l3_core_memory></tdai_profile_memory>'}]},["alpha","beta"],["默认 37 条。","最多 137 条。"]);
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
    {role:"system",content:"<available_skills>beta alpha</available_skills><tdai_profile_memory>默认 37 条。</tdai_profile_memory>"},
    {role:"user",content:"gamma <tdai_profile_memory>最多 137 条。</tdai_profile_memory>"},
  ],["alpha","beta","gamma"],["默认 37 条。","最多 137 条。"]);
  expect(result.candidate_order).toEqual(["beta","alpha"]);
  expect(result.exact_target_matches).toEqual([true,false]);
});
