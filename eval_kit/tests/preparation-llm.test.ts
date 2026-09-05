import { expect, it } from "vitest";
import { preparationFetch } from "../pipeline/preparation-llm.js";

it("只为指定准备模型请求关闭 thinking，不修改消息、工具、预算或其他请求",async () => {
  const sent:Array<{url:string;body:unknown}>=[];
  const forward:typeof fetch=async (url,init)=>{sent.push({url:String(url),body:JSON.parse(String(init?.body))});return new Response("{}");};
  const fetcher=preparationFetch(forward,"https://example.test/v1","deepseek-v4-flash");
  const body={model:"deepseek-v4-flash",messages:[{role:"user",content:"历史"}],tools:[{type:"function"}],max_tokens:4096};
  await fetcher("https://example.test/v1/chat/completions",{method:"POST",body:JSON.stringify(body)});
  await fetcher("https://other.test/chat/completions",{method:"POST",body:JSON.stringify(body)});
  expect(sent[0]!.body).toEqual({...body,thinking:{type:"disabled"}});
  expect(sent[1]!.body).toEqual(body);
});
