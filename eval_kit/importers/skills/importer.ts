import { readFile, readdir, stat } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import { load as parseYaml } from "js-yaml";

export type SkillResource = {
  path: string;
  content: string;
  encoding: "utf-8" | "base64";
};

export type SkillPackage = {
  filePath: string;
  name: string;
  description: string;
  content: string;
  resources: SkillResource[];
};

export type SkillImportTarget = {
  label: string;
  baseUrl: string;
  apiKey: string;
  serviceId: string;
  userId: string;
  teamId: string;
  agentId: string;
};

export type ConflictMode = "error" | "skip" | "update";
export type ImportAction = "created" | "updated" | "skipped" | "would-create" | "would-update";

export type SkillImportResult = {
  target: string;
  directory: string;
  dryRun: boolean;
  items: Array<{ filePath: string; name: string; action: ImportAction; skillId?: string; version?: number }>;
};

type SkillSummary = {
  skill_id: string;
  name: string;
  version: number;
  owner_agent_id?: string;
};

type ApiEnvelope<T> = { code: number; message?: string; data?: T };

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const TEXT_EXTENSIONS = new Set([
  ".cfg", ".conf", ".css", ".csv", ".go", ".html", ".js", ".json", ".jsx",
  ".md", ".markdown", ".py", ".rs", ".sh", ".toml", ".ts", ".tsx", ".txt",
  ".yaml", ".yml",
]);
const IGNORED_DIRECTORIES = new Set(["build", "coverage", "dist", "node_modules"]);

function parseSkillDocument(filePath: string, raw: string): { name: string; description: string; body: string } {
  const text = raw.replace(/\r\n?/g, "\n");
  const match = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)([\s\S]*)$/);
  if (!match) throw new Error(`${filePath}: missing valid YAML frontmatter`);
  const parsed = parseYaml(match[1] ?? "");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath}: frontmatter must be a YAML object`);
  }
  const frontmatter = parsed as Record<string, unknown>;
  const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  if (!name) throw new Error(`${filePath}: frontmatter field 'name' is required`);
  if (!NAME_RE.test(name)) throw new Error(`${filePath}: name '${name}' must match ^[a-z0-9][a-z0-9-]*$`);
  if (name.length > 64) throw new Error(`${filePath}: name exceeds 64 characters`);
  if (!description) throw new Error(`${filePath}: frontmatter field 'description' is required`);
  if (description.length > 1024) throw new Error(`${filePath}: description exceeds 1024 characters`);
  const body = match[2] ?? "";
  if (body.length > 50_000) throw new Error(`${filePath}: body exceeds 50000 characters`);
  return { name, description, body };
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && (entry.name.startsWith(".") || IGNORED_DIRECTORIES.has(entry.name))) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function extension(path: string): string {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot);
}

function asResource(path: string, bytes: Buffer): SkillResource {
  if (TEXT_EXTENSIONS.has(extension(path)) && !bytes.includes(0)) {
    return { path, content: bytes.toString("utf8"), encoding: "utf-8" };
  }
  return { path, content: bytes.toString("base64"), encoding: "base64" };
}

export async function discoverSkillPackages(directory: string): Promise<SkillPackage[]> {
  const root = resolve(directory);
  const rootStat = await stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error(`Skill directory does not exist: ${root}`);
  const files = await walk(root);
  const skillFiles = files.filter((path) => basename(path) === "SKILL.md").sort();
  if (skillFiles.length === 0) throw new Error(`No SKILL.md files found under ${root}`);

  const packages: SkillPackage[] = [];
  const names = new Map<string, string>();
  for (const filePath of skillFiles) {
    const content = await readFile(filePath, "utf8");
    const parsed = parseSkillDocument(filePath, content);
    const previous = names.get(parsed.name);
    if (previous) throw new Error(`Duplicate skill name '${parsed.name}' in ${previous} and ${filePath}`);
    names.set(parsed.name, filePath);

    const packageDirectory = resolve(filePath, "..");
    const resourcesDirectory = join(packageDirectory, "files");
    const resourceFiles = await stat(resourcesDirectory).then((value) => value.isDirectory() ? walk(resourcesDirectory) : []).catch(() => []);
    if (resourceFiles.length > 100) throw new Error(`${filePath}: resources exceed 100 files`);
    const resources: SkillResource[] = [];
    let totalBytes = 0;
    for (const resourceFile of resourceFiles) {
      const bytes = await readFile(resourceFile);
      if (bytes.byteLength > 5_000_000) throw new Error(`${resourceFile}: resource exceeds 5000000 bytes`);
      totalBytes += bytes.byteLength;
      if (totalBytes > 50 * 1024 * 1024) throw new Error(`${filePath}: resources exceed 50 MiB total`);
      const resourcePath = relative(resourcesDirectory, resourceFile).split(sep).join("/");
      resources.push(asResource(resourcePath, bytes));
    }
    packages.push({ filePath, name: parsed.name, description: parsed.description, content, resources });
  }
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

async function callApi<T>(target: SkillImportTarget, action: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${target.baseUrl.replace(/\/$/, "")}/v3/skill/${action}`, {
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
      throw new Error(`${target.label} /v3/skill/${action} failed (${envelope.code ?? response.status}): ${envelope.message ?? response.statusText}`);
    }
    return envelope.data;
  } finally {
    clearTimeout(timer);
  }
}

async function listExisting(target: SkillImportTarget): Promise<Map<string, SkillSummary>> {
  const data = await callApi<{ items: SkillSummary[]; total: number }>(target, "list", {
    user_id: target.userId,
    team_id: target.teamId,
    agent_id: target.agentId,
    filters: { owner_agent_id: target.agentId, status: ["active"] },
    pagination: { limit: 1000, offset: 0 },
  });
  return new Map(data.items.map((item) => [item.name, item]));
}

export async function importSkillDirectory(options: {
  directory: string;
  target: SkillImportTarget;
  onConflict: ConflictMode;
  dryRun: boolean;
}): Promise<SkillImportResult> {
  const packages = await discoverSkillPackages(options.directory);
  const existing = await listExisting(options.target);
  if (options.onConflict === "error") {
    const conflict = packages.find((item) => existing.has(item.name));
    if (conflict) throw new Error(`${options.target.label}: ${conflict.name} already exists for agent ${options.target.agentId}`);
  }

  const items: SkillImportResult["items"] = [];
  for (const skill of packages) {
    const current = existing.get(skill.name);
    if (current && options.onConflict === "skip") {
      items.push({ filePath: skill.filePath, name: skill.name, action: "skipped", skillId: current.skill_id, version: current.version });
      continue;
    }
    if (options.dryRun) {
      items.push({
        filePath: skill.filePath,
        name: skill.name,
        action: current ? "would-update" : "would-create",
        ...(current ? { skillId: current.skill_id, version: current.version } : {}),
      });
      continue;
    }
    if (current) {
      const updated = await callApi<{ skill_id: string; version: number }>(options.target, "update", {
        user_id: options.target.userId,
        team_id: options.target.teamId,
        agent_id: options.target.agentId,
        skill_id: current.skill_id,
        expected_version: current.version,
        content: skill.content,
      });
      items.push({ filePath: skill.filePath, name: skill.name, action: "updated", skillId: updated.skill_id, version: updated.version });
      continue;
    }
    const created = await callApi<{ skill_id: string; version: number }>(options.target, "create", {
      user_id: options.target.userId,
      team_id: options.target.teamId,
      agent_id: options.target.agentId,
      name: skill.name,
      content: skill.content,
      ...(skill.resources.length > 0 ? { resources: skill.resources } : {}),
      metadata: { source: "eval-harness-batch-import", source_file: relative(resolve(options.directory), skill.filePath) },
    });
    items.push({ filePath: skill.filePath, name: skill.name, action: "created", skillId: created.skill_id, version: created.version });
  }
  return { target: options.target.label, directory: resolve(options.directory), dryRun: options.dryRun, items };
}
