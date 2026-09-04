import { afterEach, describe, expect, test, vi } from "vitest";

import type { InputInspection } from "../data-preparation/config.js";
import { verifyPreparedTarget } from "../data-preparation/verify.js";

const inspection: InputInspection = {
  memoryCoreVersion: "2.0.0",
  skillNames: ["skill-a", "skill-b"],
  sessions: [{ sessionId: "session-a", messageCount: 4 }],
  totalMessages: 4,
};

afterEach(() => vi.unstubAllGlobals());

describe("verifyPreparedTarget", () => {
  test("checks every L0 session, expected Skill names and idle processing state", async () => {
    const paths: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      paths.push(path);
      if (path === "/v3/conversation/count") return Response.json({ code: 0, data: { total: 4 } });
      if (path === "/v3/skill/list") return Response.json({ code: 0, data: { items: [{ name: "seed-skill" }, { name: "skill-a" }, { name: "skill-b" }] } });
      if (path === "/v2/pipeline/status") return Response.json({ code: 0, data: {
        l1: { queued: 0, running: 0, queued_sessions: [], running_sessions: [], idle: true },
        l2: { queued: 0, running: 0, queued_sessions: [], running_sessions: [], idle: true },
        l3: { queued: 0, running: 0, queued_sessions: [], running_sessions: [], idle: true },
      } });
      return new Response("not found", { status: 404 });
    }));

    const result = await verifyPreparedTarget({
      target: { label: "baseline", baseUrl: "http://127.0.0.1:8420", apiKey: "key", serviceId: "rhino-ab", userId: "usr", teamId: "team", agentId: "agent" },
      inspection,
    });

    expect(result).toEqual({ target: "baseline", sessions: 1, messages: 4, skills: 2, pipelineIdle: true });
    expect(paths).toEqual(["/v3/conversation/count", "/v3/skill/list", "/v2/pipeline/status"]);
  });

  test("rejects a target whose imported L0 count differs", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 0, data: { total: 3 } })));

    await expect(verifyPreparedTarget({
      target: { label: "native", baseUrl: "http://127.0.0.1:18420", apiKey: "key", serviceId: "rhino-ab", userId: "usr", teamId: "team", agentId: "agent" },
      inspection,
    })).rejects.toThrow("session-a has 3 L0 messages; expected 4");
  });
});
