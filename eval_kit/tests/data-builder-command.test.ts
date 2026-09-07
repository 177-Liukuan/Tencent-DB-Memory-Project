import { describe, expect, test } from "vitest";

import { dataBuilderHelp, parseDataBuilderCommand } from "../data-preparation/command.js";

describe("parseDataBuilderCommand", () => {
  test("accepts one config file and optional check mode", () => {
    expect(parseDataBuilderCommand(["--config", "./builder.yaml", "--check"], "/workspace/eval_kit"))
      .toEqual({ configPath: "/workspace/eval_kit/builder.yaml", check: true });
  });

  test("rejects missing, duplicate and unknown options", () => {
    expect(() => parseDataBuilderCommand([], "/workspace/eval_kit")).toThrow("Missing required --config");
    expect(() => parseDataBuilderCommand(["--config", "a", "--config", "b"], "/workspace/eval_kit")).toThrow("only be supplied once");
    expect(() => parseDataBuilderCommand(["--config", "a", "--force"], "/workspace/eval_kit")).toThrow("Unknown option --force");
  });

  test("documents the safe read-only check", () => {
    expect(dataBuilderHelp()).toContain("--check");
    expect(dataBuilderHelp()).toContain("does not import or replace data");
  });
});
