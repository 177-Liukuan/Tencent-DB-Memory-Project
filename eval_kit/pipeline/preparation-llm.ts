// 原 Core Runner 未开放 thinking 参数。此设置仅存在于准备子进程，所有请求仍发往真实 LLM。
// 只匹配配置中的端点和模型；不改提炼提示词、Schema、结果处理或正式评测服务。
export function preparationFetch(forward:typeof fetch,baseUrl:string,model:string):typeof fetch {
  const endpoint=baseUrl.replace(/\/$/,"")+"/chat/completions";
  return async (url,init) => {
    if (String(url)===endpoint && typeof init?.body==="string") {
      const body=JSON.parse(init.body);
      if (body.model===model) return forward(url,{...init,body:JSON.stringify({...body,thinking:{type:"disabled"}})});
    }
    return forward(url,init);
  };
}
