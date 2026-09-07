type L1Result = {processedCount:number;hasMore:boolean;hasFullBacklog:boolean;profileScopes:string[]};
type Runners = {l1:(session:string)=>Promise<L1Result>;l2:(scope:string)=>Promise<unknown>;l3:()=>Promise<unknown>};

// 评测数据已一次性导入，不需要在线服务为后续消息预留的 90 秒等待。
// hasMore 包括不足一批的小尾段；全部处理后再生成场景，避免只摘要一半记忆。
export async function drainPreparedMemory(sessions: string[], runners: Runners, expectedMessages:number) {
  let processedMessages = 0;
  const scopes = new Set<string>();
  const timings: Array<{stage:string;elapsed_ms:number}> = [];
  for (const session of sessions) {
    let more: boolean;
    do {
      const start = Date.now(); const result = await runners.l1(session);
      timings.push({stage:"L1",elapsed_ms:Date.now()-start});
      more = result.hasMore || result.hasFullBacklog;
      if (!result.processedCount && more) throw new Error("L1 未推进，不生成场景");
      processedMessages += result.processedCount;
      result.profileScopes.forEach(scope=>scopes.add(scope));
    } while (more);
  }
  if (processedMessages!==expectedMessages) throw new Error(`L1 未处理全部消息: ${processedMessages}/${expectedMessages}`);
  for (const scope of scopes) {
    const start=Date.now(); await runners.l2(scope);
    timings.push({stage:"L2",elapsed_ms:Date.now()-start});
  }
  if (scopes.size) {
    const start=Date.now(); await runners.l3();
    timings.push({stage:"L3",elapsed_ms:Date.now()-start});
  }
  return {processedMessages,timings,scheduled_wait_ms:0};
}
