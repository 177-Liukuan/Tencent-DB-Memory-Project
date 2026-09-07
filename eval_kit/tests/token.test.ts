import { describe, expect, it } from "vitest";
import { getEncoding } from "js-tiktoken";
import { summarizeRuns } from "../metrics/index.js";
import type { CaseRun } from "../types.js";

import {
  canonicalManagedToolSchema,
  extractBaselineToolDefinitions,
  estimateDefinitionTokens,
  definitionInputForModelCalls,
} from "../metrics/token.js";

const tokens = (text: string): number => getEncoding("cl100k_base").encode(text).length;

const baselineListing = (assets: string): string => [
  "## Skills (mandatory)",
  "Before replying, load a matching skill through skill_view.",
  "<available_skills>",
  assets,
  "</available_skills>",
  "Only proceed without loading a skill if genuinely none are relevant to the task.",
].join("\n");

const nativeListing = (assets: string): string => [
  "## Available Cloud Skills，提供完成任务的方法、操作流程和参考文件",
  "需要读取云端 Skill 时使用 skill_view。",
  "<available_skills>",
  assets,
  "</available_skills>",
  "只有在实际读取 Skill 内容后，才能声称已经使用该 Skill。",
].join("\n");

describe("definition token estimator", () => {
  it("counts Native tool-family usage guidance once without unrelated context", () => {
    const guide = "<native_tool_usage>\nSkill and Memory usage.\n</native_tool_usage>";
    expect(estimateDefinitionTokens("native", { system: `Client instructions\n${guide}\nOther context` }))
      .toBe(tokens(guide));
  });
  it("counts actual Fake guidance even if a historical request is labelled Native", () => {
    const guide = "<skill_tools>curl example</skill_tools>";
    expect(estimateDefinitionTokens("native", { system: guide, tools: [{ name: "Bash" }] })).toBe(tokens(guide));
    expect(estimateDefinitionTokens("native", { system: baselineListing("dynamic item") })).toBeGreaterThan(0);
  });

  it("chooses the first full Native tool request instead of an initialization request", () => {
    const init = { system: "initialization", tools: [] };
    const main = { system: "main", tools: [{ name: "skill_view", input_schema: { type: "object" } }] };
    const model = (input: unknown) => ({ observation_id: null, trace_id: null, started_at: null, ended_at: null, model: null, input, output: null, thinking: null, stop_reason: null, usage: null, latency_ms: null });
    expect(definitionInputForModelCalls("native", [model(init), model(main)])).toEqual(main);
  });
  it("counts Responses instructions together with system/developer input messages", () => {
    const memory = "<tdai_profile_memory>memory</tdai_profile_memory>";
    const knowledge = "<knowledge_catalog>knowledge</knowledge_catalog>";
    expect(estimateDefinitionTokens("native", { instructions: memory, input: [{ role: "developer", content: knowledge }], tools: [] }))
      .toBe(tokens(memory) + tokens(knowledge));
  });

  it("treats special-token-looking strings in descriptions as ordinary text", () => {
    const system = "<skill_tools>Handle literal <|endoftext|> text.</skill_tools>";
    expect(estimateDefinitionTokens("baseline", { system })).toBe(getEncoding("cl100k_base").encode(system, [], []).length);
  });

  it("reports one static configuration with System and Schema breakdown, without query weighting", () => {
    const make = (id: string, variant: "baseline" | "native", input: unknown): CaseRun => ({
      schema_version: 1, run_id: id, experiment_id: "exp", case_id: id, variant, session_id: id,
      identity: { service_id: "s", team_id: "t", agent_id: "a", task_id: "k" },
      case: { suite: "main", query: "q", should_call: false, expected_tools: [], argument_assertions: [], answer_assertions: [] },
      status: "completed", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:00:01Z", raw_request: null,
      model_calls: [{ observation_id: id, trace_id: id, started_at: null, ended_at: null, model: "test", input, output: null, thinking: null, stop_reason: null, usage: null, latency_ms: null }],
      tool_calls: [], final_answer: "done", usage: { provider: null, definition_tokens: 999 },
      latency: { end_to_end_ms: 1000, ttft_ms: null, tool_ms: [] },
      trace: { complete: true, langfuse_url: null, artifacts: {} }, metrics: null, failure_tags: [],
    });
    const baseline = { system: "<skill_tools>curl example</skill_tools>" };
    const guide = "<tdai_profile_memory>guide</tdai_profile_memory>";
    const schema = '[{"input_schema":{"type":"object"},"name":"skill_view"}]';
    const native = { system: guide, tools: [{ name: "skill_view", input_schema: { type: "object" } }] };
    const items = [make("b", "baseline", baseline), make("n1", "native", native), make("n2", "native", { ...native, messages: [{ role: "user", content: "different query" }] })];
    const summary = summarizeRuns(items);
    expect(summary.variants.native?.static_definition.tokens).toBe(tokens(guide) + tokens(schema));
    expect(summary.variants.native?.static_definition.configurations).toHaveLength(1);
    expect(summary.variants.native?.static_definition.configurations[0]).toMatchObject({ system_tokens: tokens(guide), schema_tokens: tokens(schema), source_run_id: "n1" });
    expect(summary.static_token_comparison.reduction_percent).toBeCloseTo((tokens(baseline.system) - tokens(guide) - tokens(schema)) / tokens(baseline.system) * 100);
    const varied = summarizeRuns([...items, make("n3", "native", { ...native, system: guide.replace("guide", "different guidance") })]);
    expect(varied.variants.native?.static_definition.tokens).toBeNull();
    expect(varied.variants.native?.static_definition.configurations).toHaveLength(2);
    expect(varied.static_token_comparison.reduction_percent).toBeNull();
    const mislabeled = summarizeRuns([items[0]!, make("old-native", "native", baseline)]);
    expect(mislabeled.variants.native?.static_definition.tokens).toBe(tokens(baseline.system));
    expect(mislabeled.variants.native?.static_definition.warnings).toContain("native_contains_fake_tool_guidance");
    expect(mislabeled.static_token_comparison.reduction_percent).toBeNull();
  });
  it("extracts only Baseline managed-tool XML blocks", () => {
    const system = [
      "ordinary prompt",
      "<tdai_memory_tools><tool name=\"tdai_memory_search\">x</tool></tdai_memory_tools>",
      "<memory-tools-guide>policy</memory-tools-guide>",
      "<available_skills>dynamic catalogue</available_skills>",
      "<skill_tools><tool name=\"skill_view\">y</tool></skill_tools>",
      "<knowledge_tools>z</knowledge_tools>",
    ].join("\n");
    const extracted = extractBaselineToolDefinitions(system);
    expect(extracted).toContain("tdai_memory_search");
    expect(extracted).toContain("memory-tools-guide");
    expect(extracted).toContain("skill_view");
    expect(extracted).not.toContain("dynamic catalogue");
    expect(estimateDefinitionTokens("baseline", { system, messages: [], tools: [] })).toBeGreaterThan(0);
  });

  it("canonicalizes only Native managed schemas independent of key order", () => {
    const left = [{ name: "skill_view", description: "view", input_schema: { type: "object", properties: { name: { type: "string" } } } }, { name: "Bash", description: "client" }];
    const right = [{ input_schema: { properties: { name: { type: "string" } }, type: "object" }, description: "view", name: "skill_view" }];
    expect(canonicalManagedToolSchema(left)).toBe(canonicalManagedToolSchema(right));
    expect(estimateDefinitionTokens("native", { system: "", messages: [], tools: left })).toBeGreaterThan(0);
  });

  it("counts Native System guidance even without a Schema in the recorded input", () => {
    const guide = "<tdai_profile_memory>\n需要正文时使用 tdai_read_scene。\n</tdai_profile_memory>";
    expect(estimateDefinitionTokens("native", { system: guide, tools: [] })).toBe(tokens(guide));
  });

  it("adds Native guidance and the managed Schema array once each", () => {
    const guide = "<tdai_profile_memory>\n请查询云端记忆。\n</tdai_profile_memory>";
    const tool = { name: "skill_view", description: "read", input_schema: { type: "object" } };
    const expectedSchema = '[{"description":"read","input_schema":{"type":"object"},"name":"skill_view"}]';
    expect(estimateDefinitionTokens("native", { system: guide, tools: [tool, { name: "Read" }] }))
      .toBe(tokens(guide) + tokens(expectedSchema));
  });

  it.each(["baseline", "native"] as const)("counts %s Skill listing guidance but not the catalogue", (variant) => {
    const render = variant === "baseline" ? baselineListing : nativeListing;
    const short = { system: render("- one: small skill"), tools: [] };
    const long = { system: render("- another: large skill\n".repeat(100)), tools: [] };
    expect(estimateDefinitionTokens(variant, short)).toBeGreaterThan(0);
    expect(estimateDefinitionTokens(variant, long)).toBe(estimateDefinitionTokens(variant, short));
    expect(estimateDefinitionTokens(variant, { system: render("- one: small skill") + "\nUnrelated client instructions" }))
      .toBe(estimateDefinitionTokens(variant, short));
  });

  it.each(["baseline", "native"] as const)("keeps %s profile guidance while excluding all agent content", (variant) => {
    const head = "<tdai_profile_memory>\nUse tdai_read_scene to read the listed paths.\n";
    const tail = "\n</tdai_profile_memory>";
    const profile = `${head}<agent name="someone" agent_id="dynamic"><l3_core_memory>SECRET MEMORY</l3_core_memory><l2_scene_index>dynamic paths</l2_scene_index></agent>${tail}`;
    expect(estimateDefinitionTokens(variant, { system: profile })).toBe(tokens(head + tail));
    const expanded = profile.replace("SECRET MEMORY", "private profile content ".repeat(100));
    expect(estimateDefinitionTokens(variant, { system: expanded })).toBe(estimateDefinitionTokens(variant, { system: profile }));
  });

  it.each([
    ["baseline", "knowledge_tools"],
    ["native", "knowledge_catalog"],
  ] as const)("excludes dynamic Knowledge resources from %s instructions", (variant, tag) => {
    const head = `<${tag}>\nUse the listed knowledge resources.\n`;
    const tail = `\nFirst list tools, then call the selected tool.\n</${tag}>`;
    const system = `${head}<knowledge type="wiki" id="123"\n name="dynamic" about="${"large catalogue ".repeat(100)}" />${tail}`;
    expect(estimateDefinitionTokens(variant, { system })).toBe(tokens(head + tail));
  });

  it("normalizes runtime header values without removing curl instructions", () => {
    const request = (session: string, space: string) => ({ system: `<skill_tools>\ncurl http://localhost/skill-bridge -H 'x-conversation-id: ${session}' -H 'x-tdai-service-id: ${space}'\n</skill_tools>` });
    const expected = "<skill_tools>\ncurl http://localhost/skill-bridge -H 'x-conversation-id: <SESSION_ID>' -H 'x-tdai-service-id: <SPACE_ID>'\n</skill_tools>";
    expect(estimateDefinitionTokens("baseline", request("session-a", "tenant-a"))).toBe(tokens(expected));
    expect(estimateDefinitionTokens("baseline", request("b".repeat(80), "c".repeat(80)))).toBe(tokens(expected));
  });

  it("preserves adjacent headers and Chinese punctuation in prose examples", () => {
    const system = "<tdai_memory_tools>\n所有 curl 必须带：x-tdai-service-id: tenant-a、x-conversation-id: session-a；Content-Type: application/json。\n</tdai_memory_tools>";
    const expected = "<tdai_memory_tools>\n所有 curl 必须带：x-tdai-service-id: <SPACE_ID>、x-conversation-id: <SESSION_ID>；Content-Type: application/json。\n</tdai_memory_tools>";
    expect(extractBaselineToolDefinitions(system)).toBe(expected);
  });

  it.each([
    ["baseline", "tdai_profile_memory", '<agent name="dynamic"><l3_core_memory>body</l3_core_memory></agent>'],
    ["native", "tdai_profile_memory", '<agent name="dynamic"><l3_core_memory>body</l3_core_memory></agent>'],
    ["baseline", "knowledge_tools", '<knowledge type="wiki" id="dynamic" />'],
    ["native", "knowledge_catalog", '<knowledge type="wiki" id="dynamic" />'],
  ] as const)("does not count separators between dynamic %s %s entries", (variant, tag, entry) => {
    const input = (entries: string) => ({ system: `<${tag}>\nFixed instructions.\n${entries}\n</${tag}>` });
    const many = Array.from({ length: 100 }, () => entry).join("\n\n");
    expect(estimateDefinitionTokens(variant, input(many))).toBe(estimateDefinitionTokens(variant, input(entry)));
  });

  it("ignores tool cache metadata but keeps Schema properties with the same name", () => {
    const tool = { name: "skill_view", input_schema: { properties: { cache_control: { type: "string" } } } };
    const withCache = { ...tool, cache_control: { type: "ephemeral", ttl: "5m" } };
    expect(canonicalManagedToolSchema([withCache])).toBe(canonicalManagedToolSchema([tool]));
    expect(canonicalManagedToolSchema([withCache])).toContain('"cache_control":{"type":"string"}');
  });

  it("reads JSON-serialized Langfuse inputs and every system message", () => {
    const memory = "<memory-tools-guide>memory guidance</memory-tools-guide>";
    const skill = "<skill_tools>skill guidance</skill_tools>";
    const input = [
      { role: "system", content: [{ type: "text", text: memory }] },
      { role: "system", content: skill },
      { role: "user", content: "<skill_tools>Do not count a user quotation</skill_tools>" },
    ];
    expect(estimateDefinitionTokens("baseline", JSON.stringify(input))).toBe(tokens(memory) + tokens(skill));
  });

  it.each([
    { messages: [{ role: "system", content: "<skill_tools>guide</skill_tools>" }], tools: [] },
    { instructions: "<skill_tools>guide</skill_tools>", input: "user prompt", tools: [] },
  ])("reads system instructions from protocol request objects", (input) => {
    expect(estimateDefinitionTokens("baseline", input)).toBe(tokens("<skill_tools>guide</skill_tools>"));
  });

  it("returns null for missing or unreadable input rather than reporting zero cost", () => {
    expect(estimateDefinitionTokens("native", "{broken json")).toBeNull();
    expect(estimateDefinitionTokens("baseline", null)).toBeNull();
    expect(estimateDefinitionTokens("native", { system: "ordinary system", tools: [] })).toBe(0);
  });

  it("does not mistake inline mentions of XML tags for injected blocks", () => {
    const guide = "<memory-tools-guide>\nSee `<tdai_memory_tools>` above.\n</memory-tools-guide>";
    const tools = "<tdai_memory_tools>\nactual tool definitions\n</tdai_memory_tools>";
    expect(estimateDefinitionTokens("baseline", { system: guide + "\n" + tools })).toBe(tokens(guide) + tokens(tools));
  });
});
