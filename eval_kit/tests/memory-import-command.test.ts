import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { parseMemoryImportCommand } from "../importers/memories/command.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function labRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memory-import-command-"));
  await mkdir(join(root, "baseline", "secrets"), { recursive: true });
  await mkdir(join(root, "native", "secrets"), { recursive: true });
  await writeFile(join(root, "baseline", "secrets", "core-gateway.key"), "baseline-key\n");
  await writeFile(join(root, "native", "secrets", "core-gateway.key"), "native-key\n");
  return root;
}

describe("parseMemoryImportCommand", () => {
  test("builds baseline and native targets with safe conflict defaults", async () => {
    const root = await labRoot();
    const parsed = await parseMemoryImportCommand([
      "--variant", "both",
      "--directory", "/tmp/memories",
      "--user-id", "usr-1",
      "--team-id", "team-1",
      "--agent-id", "agt-1",
      "--lab-root", root,
      "--dry-run",
    ], {});

    expect(parsed.targets.map((target) => [target.label, target.apiKey, target.baseUrl])).toEqual([
      ["baseline", "baseline-key", "http://127.0.0.1:8420"],
      ["native", "native-key", "http://127.0.0.1:18420"],
    ]);
    expect(parsed.options).toEqual({
      directory: "/tmp/memories",
      onConflict: "error",
      dryRun: true,
    });
  });

  test("accepts append mode and environment overrides", async () => {
    const parsed = await parseMemoryImportCommand([
      "--variant", "native",
      "--directory", "/tmp/memories",
      "--user-id", "usr-1",
      "--team-id", "team-1",
      "--agent-id", "agt-1",
      "--on-conflict", "append",
    ], {
      TDAI_NATIVE_MEMORY_API_KEY: "env-key",
      TDAI_NATIVE_CORE_URL: "http://native.test/",
    });

    expect(parsed.targets[0]).toMatchObject({ apiKey: "env-key", baseUrl: "http://native.test" });
    expect(parsed.options.onConflict).toBe("append");
  });

  test("rejects update because L0 records are append-only", async () => {
    await expect(parseMemoryImportCommand([
      "--variant", "native",
      "--directory", "/tmp/memories",
      "--user-id", "usr-1",
      "--team-id", "team-1",
      "--agent-id", "agt-1",
      "--on-conflict", "update",
    ], { TDAI_NATIVE_MEMORY_API_KEY: "key" })).rejects.toThrow(
      "--on-conflict must be error, skip, or append",
    );
  });
});
