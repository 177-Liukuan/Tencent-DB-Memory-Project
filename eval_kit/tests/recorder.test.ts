import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LangfuseClient, pollStableObservations } from "../recorder/langfuse-client.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("Langfuse recorder", () => {
  it("follows v2 cursor pagination", async () => {
    const server = createServer((req, res) => {
      const cursor = new URL(req.url ?? "/", "http://test").searchParams.get("cursor");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(cursor
        ? { data: [{ id: "obs-2" }], meta: { nextCursor: null } }
        : { data: [{ id: "obs-1" }], meta: { nextCursor: "page-2" } }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("bad address");
    const client = new LangfuseClient({ baseUrl: `http://127.0.0.1:${addr.port}`, publicKey: "pk", secretKey: "sk" });
    await expect(client.listObservations({ sessionId: "session-a" })).resolves.toEqual([{ id: "obs-1" }, { id: "obs-2" }]);
  });

  it("finishes after two consecutive stable fingerprints", async () => {
    const list = vi.fn().mockResolvedValue([{ id: "same", updatedAt: "now" }]);
    const result = await pollStableObservations({ listObservations: list }, { sessionId: "s", intervalMs: 0, timeoutMs: 100 });
    expect(result.complete).toBe(true);
    expect(list).toHaveBeenCalledTimes(3);
  });

  it("does not declare stability until the expected proxy generations have arrived", async () => {
    const one = [{ id: "one", type: "GENERATION", metadata: { protocol: "anthropic" } }];
    const two = [...one, { id: "two", type: "GENERATION", metadata: { protocol: "anthropic" } }];
    const list = vi.fn()
      .mockResolvedValueOnce(one)
      .mockResolvedValueOnce(one)
      .mockResolvedValueOnce(one)
      .mockResolvedValueOnce(two)
      .mockResolvedValueOnce(two)
      .mockResolvedValue(two);
    const result = await pollStableObservations(
      { listObservations: list },
      { sessionId: "s", intervalMs: 0, timeoutMs: 100, minimumProxyGenerations: 2 },
    );
    expect(result.complete).toBe(true);
    expect(list).toHaveBeenCalledTimes(6);
  });
});
