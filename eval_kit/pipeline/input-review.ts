import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { LangfuseClient } from "../recorder/langfuse-client.js";
import { discoverMemorySessions } from "../importers/memories/importer.js";
import { secureWriteJson } from "../lib/fs.js";
import { selectInjectedGeneration } from "./static-tokens.js";
import type { EvalCase, Variant } from "../types.js";

export function reviewInjectedInput(input: unknown, candidates: string[], targets: string[]) {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  // Baseline 的观测保存消息数组，Native 保存请求对象；仅取 system，不能把用户输入算作注入。
  const body = (Array.isArray(parsed)
    ? {system:parsed.filter(m=>m?.role === "system").flatMap(m=>typeof m.content === "string" ? [{text:m.content}] : m.content ?? [])}
    : parsed) as {system?:unknown;thinking?:unknown;model?:unknown};
  const system = typeof body.system === "string" ? body.system : Array.isArray(body.system)
    ? body.system.map(b => typeof b?.text === "string" ? b.text : "").join("\n") : "";
  // 只保存需要审核的动态内容，不把完整请求和 Fake curl 中可能出现的身份头复制进报告。
  const memory = system.match(/<tdai_profile_memory>[\s\S]*?<\/tdai_profile_memory>/)?.[0] ?? "";
  return {
    memory,
    candidate_order:candidates.filter(name=>system.includes(name)).sort((a,b)=>system.indexOf(a)-system.indexOf(b)),
    exact_target_matches:targets.map(text=>memory.includes(text)),
    // 精确匹配只是审核线索；没有逐字命中也可能已经换一种说法给出答案，不能自动重标标签。
    review_required:true,
    upstream_thinking:body.thinking ?? "not_declared",
    model:body.model ?? null,
  };
}

export async function captureInputReviews(labRoot:string, runs:Array<{run_id:string;case_id:string;variant:Variant;session_id?:unknown}>,
  cases:EvalCase[], memoryDirectory:string, outputDirectory:string) {
  const sessions = await discoverMemorySessions(memoryDirectory);
  const clients = {} as Record<Variant,LangfuseClient>;
  for (const variant of ["baseline","native"] as const) {
    const {langfuse} = yaml.load(await readFile(join(labRoot,variant,"secrets/proxy.yaml"),"utf8")) as {
      langfuse:{host:string;publicKey:string;secretKey:string};
    };
    clients[variant] = new LangfuseClient({baseUrl:langfuse.host,publicKey:langfuse.publicKey,secretKey:langfuse.secretKey});
  }
  const rows = [];
  for (const run of runs) {
    try {
      if (typeof run.session_id !== "string") throw new Error("运行记录缺少 session_id");
      const c = cases.find(c=>c.case_id===run.case_id)!;
      const targets = (c.target_memory_refs ?? []).map(ref=>sessions.find(s=>s.sessionId===ref.session_id)!
        .messages[ref.assistant_message_index]!.content.replace(/^已记录：/,""));
      const generation = selectInjectedGeneration(await clients[run.variant].listObservations({sessionId:run.session_id}),run.variant);
      const review = {...run,observation_id:generation.id,trace_id:generation.traceId,targets,
        ...reviewInjectedInput(generation.input,c.candidate_skills ?? [],targets)};
      await secureWriteJson(join(outputDirectory,run.run_id+".json"),review);
      rows.push({run_id:run.run_id,status:"captured",exact_target_matches:review.exact_target_matches,candidate_order:review.candidate_order});
    } catch (error) {
      rows.push({run_id:run.run_id,status:"unavailable",reason:String(error)});
    }
  }
  await secureWriteJson(join(outputDirectory,"index.json"),rows);
  return rows;
}
