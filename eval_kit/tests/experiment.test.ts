import { describe, expect, it } from "vitest";

import { assertResumeCompatible, redactConfig, stableHash } from "../runner/experiment.js";

describe("experiment snapshots", () => {
  it("redacts nested credentials without changing ordinary metadata", () => {
    const snapshot = redactConfig({
      model: { name: "sonnet", api_key: "secret", public_key: "pk" },
      headers: { Authorization: "Bearer abc", "x-team-id": "team-a" },
      cookie: "session=secret",
      nested: [{ password: "pw", value: 3 }],
    });

    expect(snapshot).toEqual({
      model: { name: "sonnet", api_key: "[REDACTED]", public_key: "[REDACTED]" },
      headers: { Authorization: "[REDACTED]", "x-team-id": "team-a" },
      cookie: "[REDACTED]",
      nested: [{ password: "[REDACTED]", value: 3 }],
    });
  });

  it("hashes objects independent of key insertion order", () => {
    expect(stableHash({ a: 1, b: { c: 2 } })).toBe(stableHash({ b: { c: 2 }, a: 1 }));
  });

  it("only resumes when config and dataset hashes match", () => {
    expect(() => assertResumeCompatible({ config_hash: "a", dataset_sha256: "b" }, { config_hash: "a", dataset_sha256: "b" })).not.toThrow();
    expect(() => assertResumeCompatible({ config_hash: "a", dataset_sha256: "b" }, { config_hash: "x", dataset_sha256: "b" })).toThrow(/configuration hash/i);
    expect(() => assertResumeCompatible({ config_hash: "a", dataset_sha256: "b" }, { config_hash: "a", dataset_sha256: "x" })).toThrow(/dataset hash/i);
  });
});
