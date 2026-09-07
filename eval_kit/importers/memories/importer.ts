import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";

export type MemoryImportTarget = {
  label: string;
  baseUrl: string;
  apiKey: string;
  serviceId: string;
  userId: string;
  teamId: string;
  agentId: string;
};

export type MemoryConflictMode = "error" | "skip" | "append";

export type MemoryMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  recorded_at?: string;
};

export type MemorySession = {
  filePath: string;
  sessionId: string;
  messages: MemoryMessage[];
};

export type MemoryImportAction =
  | "imported"
  | "skipped"
  | "would-import"
  | "would-append"
  | "would-skip";

export type MemoryImportResult = {
  target: string;
  directory: string;
  dryRun: boolean;
  items: Array<{
    filePath: string;
    sessionId: string;
    action: MemoryImportAction;
    messageCount: number;
    existingCount: number;
    acceptedCount: number;
    extractionScheduled: boolean;
  }>;
};

type ApiEnvelope<T> = { code: number; message?: string; data?: T };
type InputRecord = Record<string, unknown>;

const IMPORT_EXTENSIONS = new Set([".json", ".jsonl"]);
const IGNORED_DIRECTORIES = new Set(["build", "coverage", "dist", "node_modules"]);
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGES_PER_SESSION = 10_000;
const API_BATCH_SIZE = 100;

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name))) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile() && IMPORT_EXTENSIONS.has(extname(entry.name).toLowerCase())) files.push(path);
  }
  return files;
}

function asRecord(value: unknown, location: string): InputRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${location}: session must be a JSON object`);
  }
  return value as InputRecord;
}

function isoTimestamp(value: unknown, field: string, location: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" && typeof value !== "number") {
    throw new Error(`${location}: ${field} must be an ISO timestamp or epoch milliseconds`);
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${location}: ${field} is not a valid timestamp`);
  return date.toISOString();
}

function normalizedMessages(value: unknown, location: string): MemoryMessage[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${location}: messages must be a non-empty array`);
  if (value.length > MAX_MESSAGES_PER_SESSION) {
    throw new Error(`${location}: messages exceed ${MAX_MESSAGES_PER_SESSION}`);
  }
  const messages = value.map((raw, index): MemoryMessage => {
    const messageLocation = `${location}: messages[${index}]`;
    const message = asRecord(raw, messageLocation);
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error(`${messageLocation}: role must be user or assistant`);
    }
    if (typeof message.content !== "string" || message.content.trim().length === 0) {
      throw new Error(`${messageLocation}: content must be a non-empty string`);
    }
    if (message.content.length > 8_192) throw new Error(`${messageLocation}: content exceeds 8192 characters`);
    const timestamp = isoTimestamp(message.timestamp, "timestamp", messageLocation);
    const recordedAt = isoTimestamp(message.recorded_at, "recorded_at", messageLocation);
    return {
      role: message.role,
      content: message.content,
      ...(timestamp ? { timestamp } : {}),
      ...(recordedAt ? { recorded_at: recordedAt } : {}),
    };
  });
  if (!messages.some((message) => message.role === "user")) {
    throw new Error(`${location}: at least one user message is required to trigger memory extraction`);
  }
  return messages;
}

function fallbackSessionId(root: string, filePath: string, index: number): string {
  const stem = basename(filePath, extname(filePath))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "session";
  const identity = `${relative(root, filePath).replaceAll("\\", "/")}:${index}`;
  const digest = createHash("sha256").update(identity).digest("hex").slice(0, 12);
  return `imported-${stem}-${digest}`;
}

function normalizedSession(root: string, filePath: string, value: unknown, index: number): MemorySession {
  const location = `${filePath}${index > 0 ? `#${index + 1}` : ""}`;
  const record = asRecord(value, location);
  const rawId = record.session_id ?? record.sessionId;
  if (rawId !== undefined && (typeof rawId !== "string" || rawId.trim().length === 0)) {
    throw new Error(`${location}: session_id must be a non-empty string`);
  }
  const sessionId = typeof rawId === "string" ? rawId.trim() : fallbackSessionId(root, filePath, index);
  if (sessionId.length > 256) throw new Error(`${location}: session_id exceeds 256 characters`);
  return { filePath, sessionId, messages: normalizedMessages(record.messages, location) };
}

function sessionsFromJson(root: string, filePath: string, value: unknown): MemorySession[] {
  const rawSessions = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as InputRecord).sessions)
      ? (value as InputRecord).sessions as unknown[]
      : [value];
  return rawSessions.map((entry, index) => normalizedSession(root, filePath, entry, index));
}

async function sessionsFromFile(root: string, filePath: string): Promise<MemorySession[]> {
  const info = await stat(filePath);
  if (info.size > MAX_FILE_BYTES) throw new Error(`${filePath}: file exceeds ${MAX_FILE_BYTES} bytes`);
  const raw = await readFile(filePath, "utf8");
  if (extname(filePath).toLowerCase() === ".json") {
    try {
      return sessionsFromJson(root, filePath, JSON.parse(raw) as unknown);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`${filePath}: invalid JSON: ${error.message}`);
      throw error;
    }
  }
  const sessions: MemorySession[] = [];
  for (const [lineIndex, line] of raw.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (error) {
      throw new Error(`${filePath}:${lineIndex + 1}: invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    sessions.push(normalizedSession(root, filePath, value, lineIndex));
  }
  if (sessions.length === 0) throw new Error(`${filePath}: JSONL file contains no sessions`);
  return sessions;
}

export async function discoverMemorySessions(directory: string): Promise<MemorySession[]> {
  const root = resolve(directory);
  const rootInfo = await stat(root).catch(() => null);
  if (!rootInfo?.isDirectory()) throw new Error(`Memory directory does not exist: ${root}`);
  const files = await walk(root);
  if (files.length === 0) throw new Error(`No .json or .jsonl files found under ${root}`);
  const sessions = (await Promise.all(files.map((filePath) => sessionsFromFile(root, filePath)))).flat();
  const ids = new Map<string, string>();
  for (const session of sessions) {
    const previous = ids.get(session.sessionId);
    if (previous) throw new Error(`Duplicate session_id '${session.sessionId}' in ${previous} and ${session.filePath}`);
    ids.set(session.sessionId, session.filePath);
  }
  return sessions.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
}

async function callApi<T>(
  target: MemoryImportTarget,
  action: "count" | "add",
  body: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${target.baseUrl.replace(/\/$/, "")}/v3/conversation/${action}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${target.apiKey}`,
        "content-type": "application/json",
        "x-tdai-service-id": target.serviceId,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const envelope = await response.json() as ApiEnvelope<T>;
    if (!response.ok || envelope.code !== 0 || envelope.data === undefined) {
      throw new Error(
        `${target.label} /v3/conversation/${action} failed (${envelope.code ?? response.status}): `
        + `${envelope.message ?? response.statusText}`,
      );
    }
    return envelope.data;
  } finally {
    clearTimeout(timer);
  }
}

function identity(target: MemoryImportTarget, sessionId: string): Record<string, string> {
  return {
    team_id: target.teamId,
    user_id: target.userId,
    agent_id: target.agentId,
    session_id: sessionId,
  };
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export async function importMemoryDirectory(options: {
  directory: string;
  target: MemoryImportTarget;
  onConflict: MemoryConflictMode;
  dryRun: boolean;
}): Promise<MemoryImportResult> {
  const sessions = await discoverMemorySessions(options.directory);
  const existingCounts = new Map<string, number>();
  for (const session of sessions) {
    const count = await callApi<{ total: number }>(options.target, "count", identity(options.target, session.sessionId));
    existingCounts.set(session.sessionId, count.total);
  }

  if (options.onConflict === "error") {
    const conflict = sessions.find((session) => (existingCounts.get(session.sessionId) ?? 0) > 0);
    if (conflict) {
      const count = existingCounts.get(conflict.sessionId) ?? 0;
      throw new Error(`${options.target.label}: ${conflict.sessionId} already contains ${count} L0 messages`);
    }
  }

  const items: MemoryImportResult["items"] = [];
  for (const session of sessions) {
    const existingCount = existingCounts.get(session.sessionId) ?? 0;
    if (existingCount > 0 && options.onConflict === "skip") {
      items.push({
        filePath: session.filePath,
        sessionId: session.sessionId,
        action: options.dryRun ? "would-skip" : "skipped",
        messageCount: session.messages.length,
        existingCount,
        acceptedCount: 0,
        extractionScheduled: false,
      });
      continue;
    }
    if (options.dryRun) {
      items.push({
        filePath: session.filePath,
        sessionId: session.sessionId,
        action: existingCount > 0 ? "would-append" : "would-import",
        messageCount: session.messages.length,
        existingCount,
        acceptedCount: 0,
        extractionScheduled: false,
      });
      continue;
    }

    let acceptedCount = 0;
    for (const batch of chunks(session.messages, API_BATCH_SIZE)) {
      const result = await callApi<{ accepted_ids: string[]; total_count?: number }>(options.target, "add", {
        ...identity(options.target, session.sessionId),
        messages: batch,
      });
      acceptedCount += result.accepted_ids.length;
    }
    if (acceptedCount !== session.messages.length) {
      throw new Error(
        `${options.target.label}: ${session.sessionId} accepted ${acceptedCount}/${session.messages.length} L0 messages`,
      );
    }
    items.push({
      filePath: session.filePath,
      sessionId: session.sessionId,
      action: "imported",
      messageCount: session.messages.length,
      existingCount,
      acceptedCount,
      extractionScheduled: true,
    });
  }

  return { target: options.target.label, directory: resolve(options.directory), dryRun: options.dryRun, items };
}
