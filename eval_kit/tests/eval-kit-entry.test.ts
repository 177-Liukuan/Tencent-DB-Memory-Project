import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

const workspaceRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const evalKitRoot = resolve(workspaceRoot, "eval_kit");

describe("unified eval kit entry", () => {
  test("runs the data preparation command from the eval_kit package", () => {
    const result = spawnSync("npm", ["run", "data:prepare", "--", "--help"], {
      cwd: evalKitRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stdout).toContain("Prepare one shared TencentDB Agent Memory dataset");
  });

  test("provides the short data preparation wrapper in the same directory", () => {
    const result = spawnSync(resolve(evalKitRoot, "prepare-data.sh"), ["--help"], {
      cwd: workspaceRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr || result.error?.message).toBe(0);
    expect(result.stdout).toContain("Prepare one shared TencentDB Agent Memory dataset");
  });
});
