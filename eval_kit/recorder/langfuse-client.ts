import { createHash } from "node:crypto";

import { proxyModelGenerationCount } from "./observations.js";

export type LangfuseClientOptions = { baseUrl: string; publicKey: string; secretKey: string };
export type ObservationQuery = { sessionId: string; fromStartTime?: string; toStartTime?: string };

export class LangfuseClient {
  readonly #options: LangfuseClientOptions;

  constructor(options: LangfuseClientOptions) {
    this.#options = options;
  }

  async listObservations(query: ObservationQuery): Promise<Record<string, unknown>[]> {
    const data: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    do {
      const url = new URL("/api/public/v2/observations", this.#options.baseUrl);
      url.searchParams.set("sessionId", query.sessionId);
      url.searchParams.set("fields", "core,basic,io,metadata,model,usage,time,metrics,trace_context");
      url.searchParams.set("limit", "100");
      if (query.fromStartTime) url.searchParams.set("fromStartTime", query.fromStartTime);
      if (query.toStartTime) url.searchParams.set("toStartTime", query.toStartTime);
      if (cursor) url.searchParams.set("cursor", cursor);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { authorization: `Basic ${Buffer.from(`${this.#options.publicKey}:${this.#options.secretKey}`).toString("base64")}` },
      });
      if (!response.ok) throw new Error(`Langfuse observations request failed: HTTP ${response.status}`);
      const body = await response.json() as { data?: Record<string, unknown>[]; meta?: { nextCursor?: string | null } };
      data.push(...(body.data ?? []));
      cursor = body.meta?.nextCursor ?? null;
    } while (cursor);
    return data;
  }
}

function fingerprint(observations: Record<string, unknown>[]): string {
  const compact = observations.map((observation) => ({
    id: observation.id,
    updatedAt: observation.updatedAt ?? observation.updated_at,
    endTime: observation.endTime ?? observation.end_time,
    output: observation.output,
  })).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return createHash("sha256").update(JSON.stringify(compact)).digest("hex");
}

export async function pollStableObservations(
  client: Pick<LangfuseClient, "listObservations">,
  options: ObservationQuery & { intervalMs?: number; timeoutMs?: number; minimumProxyGenerations?: number },
): Promise<{ observations: Record<string, unknown>[]; complete: boolean }> {
  const intervalMs = options.intervalMs ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const started = Date.now();
  let previous: string | null = null;
  let stableMatches = 0;
  let latest: Record<string, unknown>[] = [];
  do {
    latest = await client.listObservations(options);
    const current = fingerprint(latest);
    if (current === previous && latest.length > 0) stableMatches += 1;
    else stableMatches = 0;
    const enoughGenerations = proxyModelGenerationCount(latest) >= (options.minimumProxyGenerations ?? 0);
    if (stableMatches >= 2 && enoughGenerations) return { observations: latest, complete: true };
    previous = current;
    if (Date.now() - started >= timeoutMs) break;
    if (intervalMs > 0) await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
  return { observations: latest, complete: false };
}
