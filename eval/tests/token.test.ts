import { describe, expect, it } from "vitest";

import {
  canonicalManagedToolSchema,
  extractBaselineToolDefinitions,
  estimateDefinitionTokens,
} from "../metrics/token.js";

describe("definition token estimator", () => {
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
});
