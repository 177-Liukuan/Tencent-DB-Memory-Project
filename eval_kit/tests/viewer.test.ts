import { chmod, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createViewerApp, resolveWithin } from "../viewer/server.js";

describe("viewer path protection", () => {
  it("rejects traversal and resolves descendants", () => {
    expect(() => resolveWithin("/safe/results", "../secret")).toThrow(/outside/i);
    expect(resolveWithin("/safe/results", "exp-a/runs/a.json")).toBe("/safe/results/exp-a/runs/a.json");
  });

  it("renders untrusted trace values through textContent and never innerHTML", async () => {
    const source = await readFile(new URL("../viewer/public/app.js", import.meta.url), "utf8");
    expect(source).toContain("textContent");
    expect(source).toContain("safeHttpUrl");
    expect(source).toContain("failure_distribution");
    expect(source).toContain('section("Expected"');
    expect(source).not.toMatch(/\.innerHTML\b/u);
    expect(source).not.toContain("insertAdjacentHTML");
    expect(source).not.toMatch(/\.href\s*=\s*run\.trace\.langfuse_url/u);
  });
});

describe("viewer API", () => {
  it("lists experiments and filters cases without interpreting trace content as HTML", async () => {
    const root = await mkdtemp(join(tmpdir(), "eval-viewer-"));
    const exp = join(root, "exp-a");
    await mkdir(join(exp, "runs"), { recursive: true });
    await writeFile(join(exp, "config.json"), JSON.stringify({ experiment_id: "exp-a" }));
    await writeFile(join(exp, "summary.json"), JSON.stringify({ experiment_id: "exp-a", total_runs: 1 }));
    await writeFile(join(exp, "cases.jsonl"), `${JSON.stringify({ run_id: "run-a", case_id: "case-a", variant: "native", status: "completed", failure_tags: ["Wrong Tool"], tool_family: "memory" })}\n`);
    await writeFile(join(exp, "runs", "run-a.json"), JSON.stringify({ run_id: "run-a", final_answer: "<script>alert(1)</script>" }));
    await chmod(exp, 0o700);
    const app = createViewerApp({ resultsRoot: root });

    const experiments = await app.request("/api/experiments");
    expect(experiments.headers.get("content-security-policy")).toContain("default-src 'self'");
    expect(await experiments.json()).toEqual([{ experiment_id: "exp-a", total_runs: 1 }]);
    const cases = await app.request("/api/experiments/exp-a/cases?variant=native&failure=Wrong%20Tool");
    expect((await cases.json()).items).toHaveLength(1);
    const traversal = await app.request("/api/experiments/%2e%2e/runs/config");
    expect(traversal.status).toBeGreaterThanOrEqual(400);

    const outside = await mkdtemp(join(tmpdir(), "eval-viewer-outside-"));
    await writeFile(join(outside, "summary.json"), JSON.stringify({ secret: true }));
    await symlink(outside, join(root, "escape"), "dir");
    const symlinkEscape = await app.request("/api/experiments/escape/summary");
    expect(symlinkEscape.status).toBeGreaterThanOrEqual(400);
  });
});
