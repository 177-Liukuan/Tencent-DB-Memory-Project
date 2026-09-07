import { appendFile, chmod, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export async function secureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  await chmod(path, 0o700);
}

export async function secureWrite(path: string, content: string | Uint8Array): Promise<void> {
  await secureDirectory(dirname(path));
  const temporary = resolve(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temporary, content, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
  await chmod(path, 0o600);
}

export async function secureWriteJson(path: string, value: unknown): Promise<void> {
  await secureWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function secureWriteJsonl(path: string, values: unknown[]): Promise<void> {
  await secureWrite(path, values.length > 0 ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n` : "");
}

export async function secureAppendJsonl(path: string, value: unknown): Promise<void> {
  await secureDirectory(dirname(path));
  const handle = await open(path, "a", 0o600);
  await handle.close();
  await appendFile(path, `${JSON.stringify(value)}\n`);
  await chmod(path, 0o600);
}

export async function readJsonl(path: string): Promise<Record<string, unknown>[]> {
  try {
    const raw = await readFile(path, "utf8");
    return raw.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
