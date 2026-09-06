import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { LangfuseClient } from "../recorder/langfuse-client.js";
import { discoverMemorySessions } from "../importers/memories/importer.js";
import { secureWriteJson } from "../lib/fs.js";
import { selectInjectedGeneration } from "./static-tokens.js";
import type { EvalCase, Variant } from "../types.js";

export function reviewInjectedInput(input: unknown, skillNames: string[], targets: string[]) {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  // Baseline 的观测保存消息数组，Native 保存请求对象；仅取 system，不能把用户输入算作注入。
  const body = (Array.isArray(parsed)
    ? {system:parsed.filter(m=>m?.role === "system").flatMap(m=>typeof m.content === "string" ? [{text:m.content}] : m.content ?? [])}
    : parsed) as {system?:unknown;thinking?:unknown;model?:unknown};
  const system = typeof body.system === "string" ? body.system : Array.isArray(body.system)
    ? body.system.map(b => typeof b?.text === "string" ? b.text : "").join("\n") : "";
  // 只保存需要审核的动态内容，不把完整请求和 Fake curl 中可能出现的身份头复制进报告。
  // 说明文字也可能引用起始标签；遇到真正的下一处起始标签时，不能把前文一起吞入。
  const memory = system.match(/<tdai_profile_memory>(?:(?!<tdai_profile_memory>)[\s\S])*?<\/tdai_profile_memory>/)?.[0] ?? "";
  // 只认实际目录条目；工具使用说明或用户文本里提到名称，不代表该 Skill 已被注入。
  const listing = system.match(/<available_skills>((?:(?!<available_skills>)[\s\S])*?)<\/available_skills>/)?.[1] ?? "";
  const order = [...listing.matchAll(/^\s*-\s+([^:\n]+):/gm)].map(match => match[1]!.trim());
  return {
    memory,
    skill_listing:listing.trim(),
    candidate_order:order,
    missing_skills:skillNames.filter(name=>!order.includes(name)),
    exact_target_matches:targets.map(text=>memory.includes(text)),
    // 精确匹配只是审核线索；没有逐字命中也可能已经换一种说法给出答案，不能自动重标标签。
    review_required:true,
    upstream_thinking:body.thinking ?? "not_declared",
    model:body.model ?? null,
  };
}

export async function captureInputReviews(labRoot:string, runs:Array<{run_id:string;case_id:string;variant:Variant;session_id?:unknown}>,
  cases:EvalCase[], memoryDirectory:string, outputDirectory:string, skillNames:string[]) {
  const sessions = await discoverMemorySessions(memoryDirectory);
  const clients = {} as Record<Variant,LangfuseClient>;
  for (const variant of ["baseline","native"] as const) {
    const {langfuse} = yaml.load(await readFile(join(labRoot,variant,"secrets/proxy.yaml"),"utf8")) as {
      langfuse:{host:string;publicKey:string;secretKey:string};
    };
    clients[variant] = new LangfuseClient({baseUrl:langfuse.host,publicKey:langfuse.publicKey,secretKey:langfuse.secretKey});
  }
  const rows: Array<{
    run_id:string; status:"captured"|"unavailable"; reason?:string;
    exact_target_matches?:boolean[]; candidate_order?:string[]; missing_skills?:string[]; skill_listing?:string;
  }> = [];
  for (const run of runs) {
    try {
      if (typeof run.session_id !== "string") throw new Error("运行记录缺少 session_id");
      const c = cases.find(c=>c.case_id===run.case_id)!;
      const targets = (c.target_memory_refs ?? []).map(ref=>sessions.find(s=>s.sessionId===ref.session_id)!
        .messages[ref.assistant_message_index]!.content.replace(/^已记录：/,""));
      const generation = selectInjectedGeneration(await clients[run.variant].listObservations({sessionId:run.session_id}),run.variant);
      const review = {...run,observation_id:generation.id,trace_id:generation.traceId,targets,
        ...reviewInjectedInput(generation.input,skillNames,targets)};
      await secureWriteJson(join(outputDirectory,run.run_id+".json"),review);
      rows.push({run_id:run.run_id,status:"captured",exact_target_matches:review.exact_target_matches,candidate_order:review.candidate_order,missing_skills:review.missing_skills,skill_listing:review.skill_listing});
    } catch (error) {
      rows.push({run_id:run.run_id,status:"unavailable",reason:String(error)});
    }
  }
  await secureWriteJson(join(outputDirectory,"index.json"),rows);
  const checks = cases.map(c => {
    const pair = (["baseline", "native"] as const).map(variant => {
      const run = runs.find(r=>r.case_id===c.case_id && r.variant===variant);
      return rows.find(row=>row.run_id===run?.run_id);
    });
    const [baseline, native] = pair;
    const captured = pair.every(row=>row?.status==="captured");
    return {case_id:c.case_id,status:!captured ? "unavailable" :
      pair.every(row=>row!.missing_skills?.length===0 && row!.candidate_order?.length===skillNames.length)
      && baseline!.skill_listing===native!.skill_listing ? "matched" : "mismatch",
      baseline_order:baseline?.candidate_order,native_order:native?.candidate_order};
  });
  await secureWriteJson(join(outputDirectory,"skill-catalog-check.json"),{expected_skills:skillNames,checks});
  return rows;
}
