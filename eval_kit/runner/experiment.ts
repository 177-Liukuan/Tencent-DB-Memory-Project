import { createHash } from "node:crypto";

const SECRET_KEY = /(?:authorization|api[-_]?key|(?:public|private|access|auth)[-_]?key|secret|password|passwd|token|cookie|credential)/iu;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)]),
    );
  }
  return value;
}

export function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

export function redactConfig<T>(value: T): T {
  function walk(child: unknown): unknown {
    if (Array.isArray(child)) return child.map(walk);
    if (!child || typeof child !== "object") return child;
    return Object.fromEntries(
      Object.entries(child as Record<string, unknown>).map(([key, nested]) => [
        key,
        SECRET_KEY.test(key) ? "[REDACTED]" : walk(nested),
      ]),
    );
  }
  return walk(value) as T;
}

export type ResumeIdentity = { config_hash: string; dataset_sha256: string };

export function assertResumeCompatible(existing: ResumeIdentity, requested: ResumeIdentity): void {
  if (existing.config_hash !== requested.config_hash) {
    throw new Error("Cannot resume: configuration hash does not match the existing experiment");
  }
  if (existing.dataset_sha256 !== requested.dataset_sha256) {
    throw new Error("Cannot resume: dataset hash does not match the existing experiment");
  }
}
