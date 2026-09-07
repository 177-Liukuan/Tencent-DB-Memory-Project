import { readFile } from "node:fs/promises";

import { createClient } from "@clickhouse/client";
import yaml from "js-yaml";

import type { EvalConfig } from "../runner/config.js";

export async function queryNativeToolCalls(
  config: EvalConfig,
  input: { sessionId: string; startedAt: string; endedAt: string },
): Promise<Record<string, unknown>[]> {
  if (!config.clickhouse?.enabled) return [];
  let source: Record<string, unknown> = {};
  if (config.clickhouse.config_file) {
    const parsed = yaml.load(await readFile(config.clickhouse.config_file, "utf8"));
    if (parsed && typeof parsed === "object") source = ((parsed as Record<string, unknown>).clickhouse ?? {}) as Record<string, unknown>;
  }
  const url = config.clickhouse.url ?? (typeof source.url === "string" ? source.url : null);
  if (!url) throw new Error("ClickHouse is enabled but no URL is configured");
  const database = config.clickhouse.database ?? (typeof source.database === "string" ? source.database : "default");
  const client = createClient({
    url,
    database,
    ...(typeof source.username === "string" ? { username: source.username } : typeof source.user === "string" ? { username: source.user } : {}),
    ...(typeof source.password === "string" ? { password: source.password } : {}),
    request_timeout: 10_000,
  });
  try {
    const result = await client.query({
      query: `SELECT * FROM ${database}.tool_call_logs
        WHERE endsWith(session_key, {session:String})
          AND timestamp >= parseDateTime64BestEffort({started:String})
          AND timestamp <= parseDateTime64BestEffort({ended:String})
        ORDER BY timestamp ASC`,
      query_params: { session: input.sessionId, started: input.startedAt, ended: input.endedAt },
      format: "JSONEachRow",
    });
    return await result.json<Record<string, unknown>>();
  } finally {
    await client.close();
  }
}
