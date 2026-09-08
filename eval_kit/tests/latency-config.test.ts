import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadPilotConfig } from "../pipeline/config.js";

it("延迟配置默认 2/2/1 × 5，拒绝超长超时、工具模式误配和旧准备编号复用", async()=>{
  const example = await readFile(new URL("../configs/latency.example.yaml",import.meta.url),"utf8");
  const root=await mkdtemp(join(tmpdir(),"latency-config-")),file=join(root,"config.yaml");
  try {
    await writeFile(file,example);
    expect((await loadPilotConfig(file)).latency).toEqual({tasks:{memory:2,skill:2,none:1},repeats:5,max_replacements:5});
    for (const [text,error] of [[example.replace("timeout_ms: 600000","timeout_ms: 600001"),"单次上限"],
      [example.replace("measurement: end_to_end","measurement: tool_calls"),"仅用于"],
      [example+"\nreuse_preparation: /old\n","reuse_preparation"]]) {
      await writeFile(file,text!); await expect(loadPilotConfig(file)).rejects.toThrow(error!);
    }
  } finally { await rm(root,{recursive:true,force:true}); }
});
