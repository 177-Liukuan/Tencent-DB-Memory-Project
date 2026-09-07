import { readFile } from "node:fs/promises";
import { join } from "node:path";
import yaml from "js-yaml";
import { LangfuseClient } from "../recorder/langfuse-client.js";
import { isProxyModelGeneration } from "../recorder/observations.js";
import { canonicalManagedToolSchema, estimateDefinitionTokens, TOKENIZER_NAME } from "../metrics/token.js";
import type { Variant } from "../types.js";

export function selectInjectedGeneration(observations:Record<string,unknown>[],variant:Variant) {
  const found = observations.filter(isProxyModelGeneration)
    .sort((a,b)=>String(a.startTime).localeCompare(String(b.startTime))).find(g=>{
      const input = typeof g.input === "string" ? JSON.parse(g.input) : g.input;
      if (variant === "native") return input && canonicalManagedToolSchema(input.tools ?? []) !== "[]";
      return Number((g.metadata as Record<string,unknown>).tools_len) > 0 && (estimateDefinitionTokens(variant,input) ?? 0) > 0;
    });
  if (!found) throw new Error(`${variant}: 未找到已注入工具说明/Schema 的模型请求`);
  return found;
}

// 调用计数仍只读 Bridge。Langfuse 仅单独核对固定说明成本，不用它补造工具事件。
export async function captureStaticTokenCheck(labRoot:string,runs:Array<{variant:Variant;session_id?:unknown}>) {
  const samples = [];
  for (const variant of ["baseline","native"] as const) {
    const run = runs.find(r=>r.variant===variant && typeof r.session_id === "string");
    if (!run) throw new Error(variant+": 没有可核对的 Session");
    const proxy = yaml.load(await readFile(join(labRoot,variant,"secrets/proxy.yaml"),"utf8")) as {langfuse:{enabled:boolean;host:string;publicKey:string;secretKey:string}};
    const cfg = proxy.langfuse;
    if (!cfg?.enabled) throw new Error(variant+": Langfuse 未启用，未取得静态 Token 样本");
    const observations = await new LangfuseClient({baseUrl:cfg.host,publicKey:cfg.publicKey,secretKey:cfg.secretKey})
      .listObservations({sessionId:run.session_id as string});
    const generation = selectInjectedGeneration(observations,variant);
    const tokens = estimateDefinitionTokens(variant,generation.input);
    if (tokens === null) throw new Error(variant+": 模型输入无法计数");
    samples.push({variant,session_id:run.session_id,observation_id:generation.id,trace_id:generation.traceId,static_tokens:tokens,
      langfuse_url:cfg.host+"/project/"+generation.projectId+"/traces/"+generation.traceId});
  }
  return {status:"measured",tokenizer:TOKENIZER_NAME,samples,
    boundary:"固定 System 工具说明 + Native Schema；不含动态 Memory/Skill 内容、Query、Tool Result，不等同于服务商计费 Token",
    reduction_percent:samples[0]!.static_tokens>0 ? (samples[0]!.static_tokens-samples[1]!.static_tokens)/samples[0]!.static_tokens*100 : null};
}
