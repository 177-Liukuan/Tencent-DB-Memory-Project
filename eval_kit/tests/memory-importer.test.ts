import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  discoverMemorySessions,
  importMemoryDirectory,
  type MemoryImportTarget,
} from "../importers/memories/importer.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixtureDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "memory-importer-"));
  await mkdir(join(root, "nested"), { recursive: true });
  await writeFile(join(root, "first.json"), JSON.stringify({
    session_id: "session-one",
    messages: [
      { role: "user", content: "I prefer pnpm.", timestamp: "2026-01-01T00:00:00Z" },
      { role: "assistant", content: "Understood." },
    ],
  }));
  await writeFile(join(root, "nested", "second.jsonl"), `${JSON.stringify({
    messages: [
      { role: "user", content: "The service uses port 8080.", timestamp: 1_767_225_600_000 },
      { role: "assistant", content: "Recorded." },
    ],
  })}\n`);
  await writeFile(join(root, "ignored.txt"), "not an import file\n");
  return root;
}

type CapturedRequest = { path: string; headers: IncomingMessage["headers"]; body: Record<string, unknown> };

async function startMemoryApi(
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

function target(url: string): MemoryImportTarget {
  return {
    label: "native",
    baseUrl: url,
    apiKey: "secret-key",
    serviceId: "rhino-ab",
    userId: "usr-1",
    teamId: "team-1",
    agentId: "agt-1",
  };
}

describe("discoverMemorySessions", () => {
  test("reads JSON and JSONL sessions and creates a stable ID when omitted", async () => {
    const root = await fixtureDirectory();

    const first = await discoverMemorySessions(root);
    const second = await discoverMemorySessions(root);

    expect(first).toHaveLength(2);
    expect(first.find((session) => session.sessionId === "session-one")).toMatchObject({
      messages: [{ role: "user" }, { role: "assistant" }],
    });
    const generated = first.find((session) => session.sessionId.startsWith("imported-second-"));
    expect(generated?.sessionId).toMatch(/^imported-second-[a-f0-9]{12}$/);
    expect(generated?.messages[0]?.timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(second.map((session) => session.sessionId)).toEqual(first.map((session) => session.sessionId));
  });

  test("rejects sessions without a user message because they cannot trigger extraction", async () => {
    const root = await mkdtemp(join(tmpdir(), "memory-importer-invalid-"));
    await writeFile(join(root, "bad.json"), JSON.stringify({
      session_id: "bad",
      messages: [{ role: "assistant", content: "orphan reply" }],
    }));

    await expect(discoverMemorySessions(root)).rejects.toThrow("at least one user message");
  });
});

describe("importMemoryDirectory", () => {
  test("preflights all sessions then writes L0 in chunks of at most 100", async () => {
    const root = await mkdtemp(join(tmpdir(), "memory-importer-chunks-"));
    const messages = Array.from({ length: 201 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: `message-${index}`,
    }));
    await writeFile(join(root, "large.json"), JSON.stringify({ session_id: "large-session", messages }));
    const api = await startMemoryApi((request) => request.path.endsWith("/count")
      ? { code: 0, message: "ok", data: { total: 0 } }
      : {
          code: 0,
          message: "ok",
          data: {
            accepted_ids: (request.body.messages as unknown[]).map((_, index) => `msg-${index}`),
            total_count: (request.body.messages as unknown[]).length,
          },
        });

    const result = await importMemoryDirectory({
      directory: root,
      target: target(api.url),
      onConflict: "error",
      dryRun: false,
    });

    expect(api.requests.map((request) => request.path)).toEqual([
      "/v3/conversation/count",
      "/v3/conversation/add",
      "/v3/conversation/add",
      "/v3/conversation/add",
    ]);
    expect(api.requests.slice(1).map((request) => (request.body.messages as unknown[]).length)).toEqual([100, 100, 1]);
    expect(api.requests[1]?.body).toMatchObject({
      team_id: "team-1",
      user_id: "usr-1",
      agent_id: "agt-1",
      session_id: "large-session",
    });
    expect(api.requests[1]?.headers.authorization).toBe("Bearer secret-key");
    expect(result.items[0]).toMatchObject({
      sessionId: "large-session",
      action: "imported",
      messageCount: 201,
      acceptedCount: 201,
      extractionScheduled: true,
    });
  });

  test("error mode stops before any writes when a session already has L0 messages", async () => {
    const root = await fixtureDirectory();
    const api = await startMemoryApi((request) => ({
      code: 0,
      message: "ok",
      data: { total: request.body.session_id === "session-one" ? 2 : 0 },
    }));

    await expect(importMemoryDirectory({
      directory: root,
      target: target(api.url),
      onConflict: "error",
      dryRun: false,
    })).rejects.toThrow("session-one already contains 2 L0 messages");
    expect(api.requests.every((request) => request.path.endsWith("/count"))).toBe(true);
  });

  test("dry-run validates and reports actions without writing L0", async () => {
    const root = await fixtureDirectory();
    const api = await startMemoryApi(() => ({ code: 0, message: "ok", data: { total: 0 } }));

    const result = await importMemoryDirectory({
      directory: root,
      target: target(api.url),
      onConflict: "error",
      dryRun: true,
    });

    expect(result.items.every((item) => item.action === "would-import")).toBe(true);
    expect(api.requests.every((request) => request.path.endsWith("/count"))).toBe(true);
  });
});
