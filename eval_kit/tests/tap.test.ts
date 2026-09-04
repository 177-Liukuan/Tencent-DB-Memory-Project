import { createServer } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { startRequestTap, type RequestTap } from "../runner/tap.js";

const taps: RequestTap[] = [];
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(taps.splice(0).map((tap) => tap.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("request tap", () => {
  it("streams an upstream response while recording redacted request metadata", async () => {
    const upstream = createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream", "x-upstream": "yes" });
      res.write("data: first\n\n");
      setTimeout(() => res.end("data: second\n\n"), 10);
    });
    servers.push(upstream);
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const addr = upstream.address();
    if (!addr || typeof addr === "string") throw new Error("bad test address");

    const dir = await mkdtemp(join(tmpdir(), "eval-tap-"));
    const recordPath = join(dir, "tap.jsonl");
    const tap = await startRequestTap({ targetBaseUrl: `http://127.0.0.1:${addr.port}/anthropic`, recordPath });
    taps.push(tap);

    const response = await fetch(`${tap.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { authorization: "Bearer top-secret", "x-api-key": "also-secret", "content-type": "application/json" },
      body: JSON.stringify({ system: "s", messages: [], tools: [{ name: "x" }] }),
    });

    expect(await response.text()).toBe("data: first\n\ndata: second\n\n");
    expect(response.headers.get("x-upstream")).toBe("yes");
    await tap.flush();
    const raw = await readFile(recordPath, "utf8");
    const events = raw.trim().split(/\r?\n/u).map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(raw).not.toContain("top-secret");
    expect(raw).not.toContain("also-secret");
    expect(raw).toContain("[REDACTED]");
    expect(raw).toContain("\"tools\"");
    expect(events.some((event) => event.kind === "response_start" && event.status === 200)).toBe(true);
    expect(events.filter((event) => event.kind === "response_chunk").map((event) => event.body).join(""))
      .toBe("data: first\n\ndata: second\n\n");
    expect(events.some((event) => event.kind === "response_end")).toBe(true);
    expect(events.some((event) => event.kind === "response" && event.body === "data: first\n\ndata: second\n\n")).toBe(false);
    expect(new Set(events.map((event) => event.exchange_id))).toHaveLength(1);
    expect(events[0]?.exchange_id).toMatch(/^[a-f0-9-]{36}$/u);
  });
});
