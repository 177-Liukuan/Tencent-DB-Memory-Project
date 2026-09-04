import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import { dirname } from "node:path";
import { Readable } from "node:stream";

const REDACTED_HEADERS = /(?:^|[-_])(?:authorization|api[-_]?key|cookie|token|secret)(?:$|[-_])/iu;

export type RequestTap = {
  baseUrl: string;
  close: () => Promise<void>;
  flush: () => Promise<void>;
};

type RequestTapOptions = {
  targetBaseUrl: string;
  recordPath: string;
};

function redactHeaders(headers: IncomingHttpHeaders): Record<string, string | string[]> {
  return Object.fromEntries(Object.entries(headers).flatMap(([key, value]) => {
    if (value === undefined) return [];
    return [[key, REDACTED_HEADERS.test(key) ? "[REDACTED]" : value]];
  }));
}

export async function startRequestTap(options: RequestTapOptions): Promise<RequestTap> {
  await mkdir(dirname(options.recordPath), { recursive: true, mode: 0o700 });
  const target = new URL(options.targetBaseUrl);
  const pendingStreams = new Set<Promise<void>>();
  let writeError: unknown = null;
  let writeTail = Promise.resolve();
  const record = (value: unknown): Promise<void> => {
    writeTail = writeTail
      .then(() => appendFile(options.recordPath, `${JSON.stringify(value)}\n`, { mode: 0o600 }))
      .catch((error: unknown) => { writeError ??= error; });
    return writeTail;
  };
  const flush = async (): Promise<void> => {
    await Promise.all([...pendingStreams]);
    await writeTail;
    if (writeError) throw writeError;
  };
  const server = createServer(async (request, response) => {
    const exchangeId = randomUUID();
    const receivedAt = new Date().toISOString();
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    let parsedBody: unknown = body.toString("utf8");
    try { parsedBody = body.length ? JSON.parse(body.toString("utf8")) : null; } catch { /* preserve text */ }
    await record({
      kind: "request",
      exchange_id: exchangeId,
      at: receivedAt,
      method: request.method ?? "GET",
      path: request.url ?? "/",
      headers: redactHeaders(request.headers),
      body: parsedBody,
    });

    const upstreamUrl = new URL(request.url ?? "/", target.origin);
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (value === undefined || key.toLowerCase() === "host" || key.toLowerCase() === "content-length") continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    try {
      const requestInit: RequestInit = {
        method: request.method ?? "GET",
        headers,
        redirect: "manual",
        ...(request.method === "GET" || request.method === "HEAD" ? {} : { body }),
      };
      const upstream = await fetch(upstreamUrl, requestInit);
      response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
      await record({ kind: "response_start", exchange_id: exchangeId, at: new Date().toISOString(), status: upstream.status });
      if (!upstream.body) {
        response.end();
        await record({ kind: "response_end", exchange_id: exchangeId, at: new Date().toISOString(), status: upstream.status });
        return;
      }
      const [clientBody, recordBody] = upstream.body.tee();
      Readable.fromWeb(clientBody as never).pipe(response);
      const responseTask = (async (): Promise<void> => {
        const reader = recordBody.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const body = decoder.decode(value, { stream: true });
            if (body) await record({ kind: "response_chunk", exchange_id: exchangeId, at: new Date().toISOString(), status: upstream.status, body });
          }
          const trailing = decoder.decode();
          if (trailing) await record({ kind: "response_chunk", exchange_id: exchangeId, at: new Date().toISOString(), status: upstream.status, body: trailing });
          await record({ kind: "response_end", exchange_id: exchangeId, at: new Date().toISOString(), status: upstream.status });
        } catch (error) {
          await record({ kind: "response_record_error", exchange_id: exchangeId, at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
        }
      })();
      pendingStreams.add(responseTask);
      void responseTask.then(
        () => pendingStreams.delete(responseTask),
        () => pendingStreams.delete(responseTask),
      );
    } catch (error) {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "tap upstream failure" }));
      await record({ kind: "error", exchange_id: exchangeId, at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Request tap did not bind a TCP port");
  const basePath = target.pathname.replace(/\/$/u, "");
  return {
    baseUrl: `http://127.0.0.1:${address.port}${basePath}`,
    flush,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await flush();
    },
  };
}
