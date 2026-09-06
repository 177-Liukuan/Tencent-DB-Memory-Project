import type { JsonValue, NativeToolBackend, NativeToolEffect } from "./types.js";

export type NativeToolExposure = "memory" | "skill-read" | "skill-write" | "knowledge";

export interface NativeToolExposureContext {
  memoryEnabled: boolean;
  chatMemory: boolean;
  skillEnabled: boolean;
  skillCapability: boolean;
  allowSkillWrite: boolean;
  knowledgeEnabled?: boolean;
  knowledgeCapability?: boolean;
  knowledgeCatalogAvailable?: boolean;
}

export type NativeToolValidationResult =
  | { ok: true; value: Record<string, JsonValue> }
  | { ok: false; message: string };

export interface NativeProxyToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  owner: "proxy";
  backend: NativeToolBackend;
  effect: NativeToolEffect;
  route: string;
  exposure: NativeToolExposure;
  validate(input: unknown): NativeToolValidationResult;
}

export interface NativeProxyToolRegistry {
  list(): readonly NativeProxyToolDefinition[];
  visibleFor(context: NativeToolExposureContext): readonly NativeProxyToolDefinition[];
  get(name: string): NativeProxyToolDefinition | undefined;
  require(name: string): NativeProxyToolDefinition;
  owns(name: string): boolean;
}

type InputRecord = Record<string, unknown>;
type Normalize = (input: InputRecord) => NativeToolValidationResult;

const stringProperty = (description: string, maxLength = 2_000): Record<string, unknown> => ({
  type: "string", minLength: 1, maxLength, description,
});

const SKILL_NAME_PATTERN = "^[a-z0-9][a-z0-9-]*$";
const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9-]*$/;

const integerProperty = (minimum: number, maximum: number, defaultValue?: number): Record<string, unknown> => ({
  type: "integer", minimum, maximum,
  ...(defaultValue === undefined ? {} : { default: defaultValue }),
});

function objectSchema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length === 0 ? {} : { required }),
  };
}

function strictObject(
  input: unknown,
  allowed: readonly string[],
): { ok: true; value: InputRecord } | { ok: false; message: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, message: "input must be an object" };
  }
  const value = input as InputRecord;
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  return unknown
    ? { ok: false, message: `unknown input field: ${unknown}` }
    : { ok: true, value };
}

function stringValue(
  input: InputRecord,
  key: string,
  options: { required?: boolean; max?: number; allowEmpty?: boolean } = {},
): { ok: true; value?: string } | { ok: false; message: string } {
  const raw = input[key];
  if (raw === undefined) {
    return options.required ? { ok: false, message: `${key} is required` } : { ok: true };
  }
  if (typeof raw !== "string") return { ok: false, message: `${key} must be a string` };
  const value = options.allowEmpty ? raw : raw.trim();
  if (!options.allowEmpty && value.length === 0) return { ok: false, message: `${key} must not be empty` };
  if (value.length > (options.max ?? 2_000)) return { ok: false, message: `${key} is too long` };
  return { ok: true, value };
}

function integerValue(
  input: InputRecord,
  key: string,
  minimum: number,
  maximum: number,
  defaultValue?: number,
): { ok: true; value?: number } | { ok: false; message: string } {
  const raw = input[key] ?? defaultValue;
  if (raw === undefined) return { ok: true };
  if (!Number.isInteger(raw) || (raw as number) < minimum || (raw as number) > maximum) {
    return { ok: false, message: `${key} must be an integer between ${minimum} and ${maximum}` };
  }
  return { ok: true, value: raw as number };
}

function booleanValue(
  input: InputRecord,
  key: string,
  defaultValue?: boolean,
): { ok: true; value?: boolean } | { ok: false; message: string } {
  const raw = input[key] ?? defaultValue;
  if (raw === undefined) return { ok: true };
  return typeof raw === "boolean"
    ? { ok: true, value: raw }
    : { ok: false, message: `${key} must be a boolean` };
}

function enumValue(
  input: InputRecord,
  key: string,
  values: readonly string[],
): { ok: true; value?: string } | { ok: false; message: string } {
  const raw = input[key];
  if (raw === undefined) return { ok: true };
  return typeof raw === "string" && values.includes(raw)
    ? { ok: true, value: raw }
    : { ok: false, message: `${key} must be one of ${values.join(", ")}` };
}

function validate(input: unknown, allowed: readonly string[], normalize: Normalize): NativeToolValidationResult {
  const object = strictObject(input, allowed);
  return object.ok ? normalize(object.value) : object;
}

function success(entries: Array<[string, JsonValue | undefined]>): NativeToolValidationResult {
  return {
    ok: true,
    value: Object.fromEntries(entries.filter((entry): entry is [string, JsonValue] => entry[1] !== undefined)),
  };
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isPlainRecord(value) && Object.values(value).every(isJsonValue);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function queryValidator(input: unknown): NativeToolValidationResult {
  return validate(input, ["query", "limit"], (record) => {
    const query = stringValue(record, "query", { required: true });
    if (!query.ok) return query;
    const limit = integerValue(record, "limit", 1, 20, 5);
    return limit.ok ? success([["query", query.value], ["limit", limit.value]]) : limit;
  });
}

function idValidator(input: unknown): NativeToolValidationResult {
  return validate(input, ["skill_id"], (record) => {
    const id = stringValue(record, "skill_id", { required: true });
    return id.ok ? success([["skill_id", id.value]]) : id;
  });
}

function validateResource(value: unknown): { ok: true; value: Record<string, JsonValue> } | { ok: false; message: string } {
  const object = strictObject(value, ["path", "content", "encoding", "mime_type", "is_executable"]);
  if (!object.ok) return object;
  const path = stringValue(object.value, "path", { required: true, max: 512 });
  if (!path.ok) return path;
  const content = stringValue(object.value, "content", { required: true, max: 1_048_576, allowEmpty: true });
  if (!content.ok) return content;
  const encoding = enumValue(object.value, "encoding", ["utf-8", "base64"]);
  if (!encoding.ok) return encoding;
  const mime = stringValue(object.value, "mime_type", { max: 128 });
  if (!mime.ok) return mime;
  const executable = booleanValue(object.value, "is_executable");
  if (!executable.ok) return executable;
  return success([
    ["path", path.value], ["content", content.value], ["encoding", encoding.value ?? "utf-8"],
    ["mime_type", mime.value], ["is_executable", executable.value],
  ]) as { ok: true; value: Record<string, JsonValue> };
}

function resourceArray(
  input: InputRecord,
  key: string,
  required: boolean,
): { ok: true; value?: JsonValue[] } | { ok: false; message: string } {
  const raw = input[key];
  if (raw === undefined) return required ? { ok: false, message: `${key} is required` } : { ok: true };
  if (!Array.isArray(raw) || (required && raw.length === 0) || raw.length > 64) {
    return { ok: false, message: `${key} must contain between ${required ? 1 : 0} and 64 files` };
  }
  const result: JsonValue[] = [];
  for (const value of raw) {
    const resource = validateResource(value);
    if (!resource.ok) return { ok: false, message: `${key}: ${resource.message}` };
    result.push(resource.value);
  }
  return { ok: true, value: result };
}

function pathArray(input: InputRecord): { ok: true; value: JsonValue[] } | { ok: false; message: string } {
  const raw = input.paths;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) {
    return { ok: false, message: "paths must contain between 1 and 64 paths" };
  }
  const result: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string" || value.trim().length === 0 || value.trim().length > 512) {
      return { ok: false, message: "paths must contain non-empty strings no longer than 512 characters" };
    }
    result.push(value.trim());
  }
  return { ok: true, value: result };
}

function definition(value: Omit<NativeProxyToolDefinition, "owner">): NativeProxyToolDefinition {
  return Object.freeze({ owner: "proxy" as const, ...value });
}

const resourceSchema = objectSchema({
  path: stringProperty("Skill 资源中的相对路径", 512),
  content: { type: "string", maxLength: 1_048_576 },
  encoding: { type: "string", enum: ["utf-8", "base64"], default: "utf-8" },
  mime_type: { type: "string", maxLength: 128 },
  is_executable: { type: "boolean" },
}, ["path", "content"]);

// 顶层 description 只说明工具用途、选择条件和前后调用关系。
// Memory/Skill description 迁移 Baseline 的 use，保留用途和调用条件，不另加工具选择优先级。
// 参数校验与执行约束维持现状；传输说明和已过时的删除语义不能照搬。
const TOOLS: readonly NativeProxyToolDefinition[] = Object.freeze([
  definition({
    name: "tdai_memory_search",
    description: "搜索 L1 原子记忆（双路 hybrid: dense vector + BM25），按相关度排序。默认跨当前 Agent 的 self + imported 记忆检索；返回项里的 source_agent_* 表示来源。适合回忆用户偏好、历史结论、规则等。",
    inputSchema: objectSchema({ query: stringProperty("检索问题或关键词"), limit: integerProperty(1, 20, 5) }, ["query"]),
    backend: "memory", effect: "read", route: "atomic/search", exposure: "memory", validate: queryValidator,
  }),
  definition({
    name: "tdai_atomic_query",
    description: "按 type / 时间窗 / 分页拉取 L1 记忆（不做语义检索）。",
    inputSchema: objectSchema({
      type: { type: "string", enum: ["episodic", "persona", "instruction"] },
      limit: integerProperty(1, 100, 20), offset: integerProperty(0, 100_000, 0),
      time_start: { type: "string", format: "date-time" }, time_end: { type: "string", format: "date-time" },
    }),
    backend: "memory", effect: "read", route: "atomic/query", exposure: "memory",
    validate: (input) => validate(input, ["type", "limit", "offset", "time_start", "time_end"], (record) => {
      const type = enumValue(record, "type", ["episodic", "persona", "instruction"]); if (!type.ok) return type;
      const limit = integerValue(record, "limit", 1, 100, 20); if (!limit.ok) return limit;
      const offset = integerValue(record, "offset", 0, 100_000, 0); if (!offset.ok) return offset;
      const start = stringValue(record, "time_start", { max: 64 }); if (!start.ok) return start;
      const end = stringValue(record, "time_end", { max: 64 }); if (!end.ok) return end;
      if (start.value && !Number.isFinite(Date.parse(start.value))) return { ok: false, message: "time_start must be an ISO timestamp" };
      if (end.value && !Number.isFinite(Date.parse(end.value))) return { ok: false, message: "time_end must be an ISO timestamp" };
      return success([["type", type.value], ["limit", limit.value], ["offset", offset.value], ["time_start", start.value], ["time_end", end.value]]);
    }),
  }),
  definition({
    name: "tdai_conversation_search",
    description: "在 L0 原始对话中检索（比 tdai_memory_search 粒度更细，找具体消息原文 / 引用 / 时间线）。默认跨当前 Agent 的 self + imported 记忆检索；返回项里的 source_agent_* 表示来源。",
    inputSchema: objectSchema({ query: stringProperty("检索问题或关键词"), limit: integerProperty(1, 20, 5), session_id: stringProperty("可选的历史会话标识") }, ["query"]),
    backend: "memory", effect: "read", route: "conversation/search", exposure: "memory",
    validate: (input) => validate(input, ["query", "limit", "session_id"], (record) => {
      const query = stringValue(record, "query", { required: true }); if (!query.ok) return query;
      const limit = integerValue(record, "limit", 1, 20, 5); if (!limit.ok) return limit;
      const session = stringValue(record, "session_id"); if (!session.ok) return session;
      return success([["query", query.value], ["limit", limit.value], ["session_id", session.value]]);
    }),
  }),
  definition({
    name: "tdai_conversation_query",
    description: "按 session 顺序取 L0 历史消息。",
    inputSchema: objectSchema({ session_id: stringProperty("需要读取的会话标识"), limit: integerProperty(1, 200, 50), offset: integerProperty(0, 100_000, 0) }, ["session_id"]),
    backend: "memory", effect: "read", route: "conversation/query", exposure: "memory",
    validate: (input) => validate(input, ["session_id", "limit", "offset"], (record) => {
      const session = stringValue(record, "session_id", { required: true }); if (!session.ok) return session;
      const limit = integerValue(record, "limit", 1, 200, 50); if (!limit.ok) return limit;
      const offset = integerValue(record, "offset", 0, 100_000, 0); if (!offset.ok) return offset;
      return success([["session_id", session.value], ["limit", limit.value], ["offset", offset.value]]);
    }),
  }),
  definition({
    name: "tdai_scenario_ls",
    description: "列出 L2 scene_blocks 路径索引（含 summary，不含正文）。一般 system 已注入索引，需刷新/按前缀过滤时才用。",
    inputSchema: objectSchema({ path_prefix: { type: "string", maxLength: 1_024 } }),
    backend: "memory", effect: "read", route: "scenario/ls", exposure: "memory",
    validate: (input) => validate(input, ["path_prefix"], (record) => {
      const prefix = stringValue(record, "path_prefix", { max: 1_024, allowEmpty: true });
      return prefix.ok ? success([["path_prefix", prefix.value]]) : prefix;
    }),
  }),
  definition({
    name: "tdai_read_scene",
    description: "按 path 读取 L2 场景文件全文。path 必须先从 `<l2_scene_index>` 或 tdai_scenario_ls 获取，不要凭空构造；读取 imported_from 分段的 path 时带上该分段 agent_id。",
    inputSchema: objectSchema({
      path: stringProperty("场景路径", 1_024),
      // L2 内容按 Agent 保存；借入场景需要把目录里的来源标识交给 Bridge 选择已授权数据源。
      agent_id: stringProperty("借入场景所属的 Agent 标识", 256),
    }, ["path"]),
    backend: "memory", effect: "read", route: "scenario/read", exposure: "memory",
    validate: (input) => validate(input, ["path", "agent_id"], (record) => {
      const path = stringValue(record, "path", { required: true, max: 1_024 });
      if (!path.ok) return path;
      const agentId = stringValue(record, "agent_id", { max: 256 });
      return agentId.ok
        ? success([["path", path.value], ["agent_id", agentId.value]])
        : agentId;
    }),
  }),
  definition({
    name: "skill_search",
    description: "在**你在团队中有权限访问**的 skill 中按关键词 + 语义检索匹配项（跨 agent，但**不含**其他人设置为私密的 skill —— 与前端「团队资产」tab 展示一致）。query 必须是非空字符串，建议写 2-5 个相关关键词。当你觉得自己自带的 skill 不够用时，用它发现团队里其他可用的 skill。返回条数由服务端固定，若结果不理想请换一组关键词重试，不要添加 top_k/mode 等 Schema 中未定义的参数（会被拒绝）。",
    inputSchema: objectSchema({ query: stringProperty("Skill 关键词") }, ["query"]),
    backend: "skill", effect: "read", route: "search", exposure: "skill-read",
    validate: (input) => validate(input, ["query"], (record) => {
      const query = stringValue(record, "query", { required: true });
      return query.ok ? success([["query", query.value]]) : query;
    }),
  }),
  definition({
    name: "skill_view",
    description: "**打开一个 skill 的入口**：拿到 SKILL.md 全文 + 资源目录树（manifest）。想读某个资源文件的字节，必须先调这个工具从 manifest 里挑出 path，再用 skill_files_read。skill_name 用 <available_skills> 里 `- name: description` 那个 name，或 skill_search 结果里的 name 字段。",
    inputSchema: objectSchema({ skill_name: stringProperty("Skill 名称", 64) }, ["skill_name"]),
    backend: "skill", effect: "read", route: "get-by-name", exposure: "skill-read",
    validate: (input) => validate(input, ["skill_name"], (record) => {
      const name = stringValue(record, "skill_name", { required: true, max: 64 });
      return name.ok ? success([["skill_name", name.value], ["include_content", true], ["include_manifest", true]]) : name;
    }),
  }),
  definition({
    name: "skill_files_read",
    description: "读取单个资源文件内容。**必须先调 skill_view 拿 manifest**，从里面挑出 skill_id + path，本工具才能定位。返回文件内容及编码等信息。",
    inputSchema: objectSchema({ skill_id: stringProperty("Skill 标识"), path: stringProperty("资源相对路径", 1_024), encoding: { type: "string", enum: ["utf-8", "base64"], default: "utf-8" } }, ["skill_id", "path"]),
    backend: "skill", effect: "read", route: "files/read", exposure: "skill-read",
    validate: (input) => validate(input, ["skill_id", "path", "encoding"], (record) => {
      const id = stringValue(record, "skill_id", { required: true }); if (!id.ok) return id;
      const path = stringValue(record, "path", { required: true, max: 1_024 }); if (!path.ok) return path;
      const encoding = enumValue(record, "encoding", ["utf-8", "base64"]); if (!encoding.ok) return encoding;
      return success([["skill_id", id.value], ["path", path.value], ["encoding", encoding.value ?? "utf-8"]]);
    }),
  }),
  definition({
    name: "skill_extract",
    description: "立即归档当前对话触发一次 skill 抽取（异步任务，由后台 agent 分析对话内容生成 skill）。使用当前会话已累积的对话，你不用传 messages。适合在\"用户已经跑通一段完整流程、值得复用\"时主动触发。",
    inputSchema: objectSchema({ reason: { type: "string", description: "简要说明为什么觉得当前对话值得提取为 skill（写清楚有助于后台抽取器识别边界）", maxLength: 2_000 } }),
    backend: "skill", effect: "archive", route: "extract", exposure: "skill-read",
    validate: (input) => validate(input, ["reason"], (record) => {
      const reason = stringValue(record, "reason");
      return reason.ok ? success([["reason", reason.value]]) : reason;
    }),
  }),
  definition({
    name: "skill_create",
    description: "新建 skill；owner 自动 = 当前 agent。",
    inputSchema: objectSchema({
      name: { ...stringProperty("Skill 名称，仅使用小写字母、数字和连字符", 64), pattern: SKILL_NAME_PATTERN },
      content: stringProperty("SKILL.md 全文（含 frontmatter）；frontmatter.name 必须与 name 相同", 262_144),
      resources: { type: "array", description: "创建 Skill 时附带的资源文件", maxItems: 64, items: resourceSchema },
    }, ["name", "content"]),
    backend: "skill", effect: "write", route: "create", exposure: "skill-write",
    validate: (input) => validate(input, ["name", "content", "resources"], (record) => {
      const name = stringValue(record, "name", { required: true, max: 64 }); if (!name.ok) return name;
      if (!SKILL_NAME_REGEX.test(name.value!)) {
        return { ok: false, message: "name must contain only lowercase letters, digits, and hyphens" };
      }
      const content = stringValue(record, "content", { required: true, max: 262_144 }); if (!content.ok) return content;
      const resources = resourceArray(record, "resources", false); if (!resources.ok) return resources;
      return success([["name", name.value], ["content", content.value], ["resources", resources.value]]);
    }),
  }),
  definition({
    name: "skill_update",
    description: "替换 SKILL.md（version+1）。",
    inputSchema: objectSchema({ skill_id: stringProperty("Skill 标识"), content: stringProperty("新的完整 SKILL.md，不能更改 frontmatter.name", 262_144) }, ["skill_id", "content"]),
    backend: "skill", effect: "write", route: "update", exposure: "skill-write",
    validate: (input) => validate(input, ["skill_id", "content"], (record) => {
      const id = stringValue(record, "skill_id", { required: true }); if (!id.ok) return id;
      const content = stringValue(record, "content", { required: true, max: 262_144 }); if (!content.ok) return content;
      return success([["skill_id", id.value], ["content", content.value]]);
    }),
  }),
  definition({
    name: "skill_patch",
    description: "SKILL.md 子串替换（避免大 diff）。",
    inputSchema: objectSchema({ skill_id: stringProperty("Skill 标识"), old_string: stringProperty("需要在 SKILL.md 中匹配的原文本", 262_144), new_string: { type: "string", description: "替换后的文本，可为空字符串", maxLength: 262_144 }, replace_all: { type: "boolean", description: "是否替换所有匹配项；false 时 old_string 必须唯一匹配", default: false } }, ["skill_id", "old_string", "new_string"]),
    backend: "skill", effect: "write", route: "patch", exposure: "skill-write",
    validate: (input) => validate(input, ["skill_id", "old_string", "new_string", "replace_all"], (record) => {
      const id = stringValue(record, "skill_id", { required: true }); if (!id.ok) return id;
      const oldText = stringValue(record, "old_string", { required: true, max: 262_144 }); if (!oldText.ok) return oldText;
      const newText = stringValue(record, "new_string", { required: true, max: 262_144, allowEmpty: true }); if (!newText.ok) return newText;
      const replaceAll = booleanValue(record, "replace_all", false); if (!replaceAll.ok) return replaceAll;
      return success([["skill_id", id.value], ["old_string", oldText.value], ["new_string", newText.value], ["replace_all", replaceAll.value]]);
    }),
  }),
  definition({
    name: "skill_delete",
    description: "永久删除当前 Agent 拥有的 Skill，包括所有版本和资源文件。",
    inputSchema: objectSchema({ skill_id: stringProperty("Skill 标识") }, ["skill_id"]),
    backend: "skill", effect: "write", route: "delete", exposure: "skill-write", validate: idValidator,
  }),
  definition({
    name: "skill_files_write",
    description: "增/改资源文件（version+1）。",
    inputSchema: objectSchema({ skill_id: stringProperty("Skill 标识"), files: { type: "array", description: "要新增或覆盖的资源文件", minItems: 1, maxItems: 64, items: resourceSchema } }, ["skill_id", "files"]),
    backend: "skill", effect: "write", route: "files/write", exposure: "skill-write",
    validate: (input) => validate(input, ["skill_id", "files"], (record) => {
      const id = stringValue(record, "skill_id", { required: true }); if (!id.ok) return id;
      const files = resourceArray(record, "files", true); if (!files.ok) return files;
      return success([["skill_id", id.value], ["files", files.value]]);
    }),
  }),
  definition({
    name: "skill_files_remove",
    description: "删资源文件（实际删除文件时 version+1）。",
    inputSchema: objectSchema({ skill_id: stringProperty("Skill 标识"), paths: { type: "array", description: "要删除的资源相对路径", minItems: 1, maxItems: 64, items: stringProperty("资源相对路径", 512) } }, ["skill_id", "paths"]),
    backend: "skill", effect: "write", route: "files/remove", exposure: "skill-write",
    validate: (input) => validate(input, ["skill_id", "paths"], (record) => {
      const id = stringValue(record, "skill_id", { required: true }); if (!id.ok) return id;
      const paths = pathArray(record); if (!paths.ok) return paths;
      return success([["skill_id", id.value], ["paths", paths.value]]);
    }),
  }),
  definition({
    name: "tdai_knowledge_tools_list",
    description: "获取指定已授权 Knowledge 资源当前提供的工具清单、用途和参数说明；首次使用目录中的 knowledge_id 时先调用本工具。",
    inputSchema: objectSchema({
      knowledge_id: stringProperty("Knowledge 资源目录中的资源标识", 256),
    }, ["knowledge_id"]),
    backend: "knowledge",
    effect: "read",
    route: "tools/list",
    exposure: "knowledge",
    validate: (input) => validate(input, ["knowledge_id"], (record) => {
      const id = stringValue(record, "knowledge_id", { required: true, max: 256 });
      return id.ok ? success([["knowledge_id", id.value]]) : id;
    }),
  }),
  definition({
    name: "tdai_knowledge_tool_call",
    description: "执行 tdai_knowledge_tools_list 返回的 Knowledge 查询工具；tool_name 和 params 必须严格采用该资源最新工具清单中的定义。",
    inputSchema: objectSchema({
      knowledge_id: stringProperty("Knowledge 资源目录中的资源标识", 256),
      tool_name: stringProperty("工具清单返回的工具名称", 128),
      params: {
        type: "object",
        description: "按工具清单中的参数说明填写；无参数工具传空对象",
        additionalProperties: true,
      },
    }, ["knowledge_id", "tool_name", "params"]),
    backend: "knowledge",
    effect: "read",
    route: "tools/call",
    exposure: "knowledge",
    validate: (input) => validate(input, ["knowledge_id", "tool_name", "params"], (record) => {
      const id = stringValue(record, "knowledge_id", { required: true, max: 256 });
      if (!id.ok) return id;
      const toolName = stringValue(record, "tool_name", { required: true, max: 128 });
      if (!toolName.ok) return toolName;
      if (!isPlainRecord(record.params) || !isJsonValue(record.params)) {
        return { ok: false, message: "params must be a JSON object" };
      }
      if (Object.keys(record.params).length > 64 || Buffer.byteLength(JSON.stringify(record.params), "utf8") > 65_536) {
        return { ok: false, message: "params exceed the allowed size" };
      }
      return success([
        ["knowledge_id", id.value],
        ["tool_name", toolName.value],
        ["params", record.params],
      ]);
    }),
  }),
]);

class DefaultNativeProxyToolRegistry implements NativeProxyToolRegistry {
  private readonly toolsByName = new Map(TOOLS.map((tool) => [tool.name, tool]));

  list(): readonly NativeProxyToolDefinition[] { return TOOLS; }

  visibleFor(context: NativeToolExposureContext): readonly NativeProxyToolDefinition[] {
    return TOOLS.filter((tool) => {
      if (tool.exposure === "memory") return context.memoryEnabled && context.chatMemory;
      if (tool.exposure === "knowledge") {
        return context.knowledgeEnabled === true
          && context.knowledgeCapability === true
          && context.knowledgeCatalogAvailable === true;
      }
      if (!context.skillEnabled || !context.skillCapability) return false;
      return tool.exposure === "skill-read" || context.allowSkillWrite;
    });
  }

  get(name: string): NativeProxyToolDefinition | undefined { return this.toolsByName.get(name); }

  require(name: string): NativeProxyToolDefinition {
    const tool = this.get(name);
    if (!tool) throw new Error(`Unknown Native Proxy Tool: ${name}`);
    return tool;
  }

  owns(name: string): boolean { return this.toolsByName.has(name); }
}

export function createDefaultNativeProxyToolRegistry(): NativeProxyToolRegistry {
  return new DefaultNativeProxyToolRegistry();
}
