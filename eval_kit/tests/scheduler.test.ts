import { describe, expect, it } from "vitest";

import { buildRunSchedule } from "../runner/scheduler.js";
import type { EvalCase } from "../types.js";

const cases = ["a", "b", "c", "d"].map((case_id): EvalCase => ({
  schema_version: 1,
  case_id,
  suite: "smoke",
  query: case_id,
  should_call: false,
  expected_tools: [],
}));

describe("paired scheduler", () => {
  it("is seed-stable and alternates variant-first order by pair", () => {
    const first = buildRunSchedule(cases, 20260831);
    const second = buildRunSchedule(cases, 20260831);
    expect(first).toEqual(second);
    expect(first).toHaveLength(8);
    for (let pair = 0; pair < 4; pair += 1) {
      const entries = first.slice(pair * 2, pair * 2 + 2);
      expect(entries[0]?.case_id).toBe(entries[1]?.case_id);
      expect(entries.map((entry) => entry.variant)).toEqual(pair % 2 === 0 ? ["baseline", "native"] : ["native", "baseline"]);
    }
  });

  it("supports case and variant filters without changing stable run IDs", () => {
    const selected = buildRunSchedule(cases, 20260831, { caseIds: new Set(["b"]), variants: new Set(["native"]) });
    expect(selected).toEqual([{ run_id: "b--native", case_id: "b", variant: "native", pair_index: expect.any(Number), order_index: 0 }]);
  });
});
