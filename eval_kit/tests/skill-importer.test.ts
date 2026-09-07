import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  discoverSkillPackages,
  importSkillDirectory,
  type SkillImportTarget,
} from "../importers/skills/importer.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixtureDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skill-importer-"));
  const first = join(root, "alpha");
  const second = join(root, "nested", "beta");
  await mkdir(join(first, "files"), { recursive: true });
  await mkdir(second, { recursive: true });
  await writeFile(
    join(first, "SKILL.md"),
    "---\nname: alpha-skill\ndescription: Alpha description\n---\n\n# Alpha\n",
  );
  await writeFile(join(first, "files", "guide.txt"), "guide text\n");
  await writeFile(
    join(second, "SKILL.md"),
    "---\nname: beta-skill\ndescription: Beta description\n---\n\n# Beta\n",
  );
  return root;
}

type CapturedRequest = { path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };

async function startSkillApi(
  handler: (request: CapturedRequest) => Record<string, unknown>,
): Promise<{ url: string; requests: CapturedRequest[] }> {
  const requests: CapturedRequest[] = [];
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const request: CapturedRequest = {
      path: req.url ?? "",
      headers: req.headers,
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>,
    };
    requests.push(request);
    const response = handler(request);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind");
  cleanups.push(() => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  return { url: `http://127.0.0.1:${address.port}`, requests };
}

function target(url: string): SkillImportTarget {
  return {
    label: "native",
    baseUrl: url,
    apiKey: "secret-test-key",
    serviceId: "rhino-ab",
    userId: "usr-1",
    teamId: "team-1",
    agentId: "agt-1",
  };
}

describe("discoverSkillPackages", () => {
  test("导入标准 Skill 的 references/scripts/assets，不漏掉正文引用的资源", async () => {
    const root = await fixtureDirectory();
    for (const directory of ["references", "scripts", "assets"]) {
      await mkdir(join(root, "alpha", directory));
      await writeFile(join(root, "alpha", directory, "example.txt"), directory);
    }
    const [skill] = await discoverSkillPackages(root);
    expect(skill!.resources.map(r => r.path).sort()).toEqual([
      "assets/example.txt", "guide.txt", "references/example.txt", "scripts/example.txt",
    ]);
  });
  test("recursively reads SKILL.md files and only their files/ resources", async () => {
    const root = await fixtureDirectory();
    await writeFile(join(root, "alpha", "notes.md"), "not a resource");
    await mkdir(join(root, "node_modules", "dependency"), { recursive: true });
    await writeFile(
      join(root, "node_modules", "dependency", "SKILL.md"),
      "---\nname: dependency-skill\ndescription: Must not be imported\n---\n\n# Dependency\n",
    );

    const packages = await discoverSkillPackages(root);

    expect(packages.map((item) => item.name)).toEqual(["alpha-skill", "beta-skill"]);
    expect(packages[0]?.resources).toEqual([
      { path: "guide.txt", content: "guide text\n", encoding: "utf-8" },
    ]);
    expect(packages[1]?.resources).toEqual([]);
  });

  test("rejects a document whose name violates the Memory Core contract", async () => {
    const root = await mkdtemp(join(tmpdir(), "skill-importer-invalid-"));
    await writeFile(join(root, "SKILL.md"), "---\nname: Bad Name\ndescription: valid\n---\n\n# Bad\n");

    await expect(discoverSkillPackages(root)).rejects.toThrow("must match ^[a-z0-9][a-z0-9-]*$");
  });
});

describe("importSkillDirectory", () => {
  test("creates every discovered skill with the requested owner and service headers", async () => {
    const root = await fixtureDirectory();
    const api = await startSkillApi((request) => request.path.endsWith("/list")
      ? { code: 0, message: "ok", data: { items: [], total: 0 } }
      : { code: 0, message: "ok", data: { skill_id: `skl-${String(request.body.name)}`, version: 1 } });

    const result = await importSkillDirectory({
      directory: root,
      target: target(api.url),
      onConflict: "error",
      dryRun: false,
    });

    expect(result.items.map((item) => [item.name, item.action])).toEqual([
      ["alpha-skill", "created"],
      ["beta-skill", "created"],
    ]);
    const create = api.requests.find((request) => request.path.endsWith("/create"));
    expect(create?.headers.authorization).toBe("Bearer secret-test-key");
    expect(create?.headers["x-tdai-service-id"]).toBe("rhino-ab");
    expect(create?.body).toMatchObject({
      user_id: "usr-1",
      team_id: "team-1",
      agent_id: "agt-1",
      name: "alpha-skill",
      resources: [{ path: "guide.txt", content: "guide text\n", encoding: "utf-8" }],
    });
  });

  test("stops before writes when an existing name is found and conflict mode is error", async () => {
    const root = await fixtureDirectory();
    const api = await startSkillApi((request) => request.path.endsWith("/list")
      ? {
          code: 0,
          message: "ok",
          data: {
            items: [{ skill_id: "skl-alpha", name: "alpha-skill", version: 3, owner_agent_id: "agt-1" }],
            total: 1,
          },
        }
      : { code: 0, message: "ok", data: {} });

    await expect(importSkillDirectory({
      directory: root,
      target: target(api.url),
      onConflict: "error",
      dryRun: false,
    })).rejects.toThrow("alpha-skill already exists");
    expect(api.requests.map((request) => request.path)).toEqual(["/v3/skill/list"]);
  });

  test("updates existing content with its current version and leaves resources untouched", async () => {
    const root = await fixtureDirectory();
    const api = await startSkillApi((request) => request.path.endsWith("/list")
      ? {
          code: 0,
          message: "ok",
          data: {
            items: [{ skill_id: "skl-alpha", name: "alpha-skill", version: 3, owner_agent_id: "agt-1" }],
            total: 1,
          },
        }
      : { code: 0, message: "ok", data: { skill_id: "skl-alpha", version: 4 } });

    const result = await importSkillDirectory({
      directory: root,
      target: target(api.url),
      onConflict: "update",
      dryRun: false,
    });

    expect(result.items.map((item) => [item.name, item.action])).toEqual([
      ["alpha-skill", "updated"],
      ["beta-skill", "created"],
    ]);
    expect(api.requests.find((request) => request.path.endsWith("/update"))?.body).toMatchObject({
      skill_id: "skl-alpha",
      expected_version: 3,
      user_id: "usr-1",
      team_id: "team-1",
      agent_id: "agt-1",
    });
  });

  test("dry-run reports planned work without calling create or update", async () => {
    const root = await fixtureDirectory();
    const api = await startSkillApi(() => ({ code: 0, message: "ok", data: { items: [], total: 0 } }));

    const result = await importSkillDirectory({
      directory: root,
      target: target(api.url),
      onConflict: "error",
      dryRun: true,
    });

    expect(result.items.map((item) => item.action)).toEqual(["would-create", "would-create"]);
    expect(api.requests.map((request) => request.path)).toEqual(["/v3/skill/list"]);
  });
});
