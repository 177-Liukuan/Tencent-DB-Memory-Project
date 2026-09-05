import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { snapshotWorkspace } from "../pipeline/workspace.js";
import { drainPreparedMemory } from "../pipeline/prepare-memory.js";

describe("评测准备", () => {
  it("同一素材的任务及重复运行互不影响，修改来源后产生不同版本", async () => {
    const root = await mkdtemp(join(tmpdir(),"eval-assets-"));
    const source = join(root,"source"); await mkdir(source);
    await writeFile(join(source,"main.ts"),"original");
    const first = await snapshotWorkspace(source,join(root,"first"));
    await writeFile(join(first.directory,"main.ts"),"task edited");
    const second = await snapshotWorkspace(source,join(root,"second"));
    expect(await readFile(join(second.directory,"main.ts"),"utf8")).toBe("original");
    expect(first.digest).toBe(second.digest);
    await writeFile(join(source,"main.ts"),"dataset updated");
    const third = await snapshotWorkspace(source,join(root,"third"));
    expect(third.digest).not.toBe(first.digest);
  });
  it("L1 的小尾段也必须处理完才执行一次 L2 和 L3，不依赖计时等待", async () => {
    const events: string[] = []; let calls = 0;
    const result = await drainPreparedMemory(["s"],{
      l1:async () => { events.push("L1"); calls++; return {processedCount: calls===1?10:3,hasMore:calls===1,hasFullBacklog:false,profileScopes:["profile:a"]}; },
      l2:async scope => {events.push("L2:"+scope);},
      l3:async () => {events.push("L3");},
    },13);
    expect(events).toEqual(["L1","L1","L2:profile:a","L3"]);
    expect(result.processedMessages).toBe(13);
  });
  it("L1 无进展时停止，不拿半成品生成 L2", async () => {
    let laterCalled = false;
    await expect(drainPreparedMemory(["s"],{
      l1:async () => ({processedCount:0,hasMore:true,hasFullBacklog:false,profileScopes:[]}),
      l2:async () => {laterCalled=true;},l3:async () => {laterCalled=true;},
    },1)).rejects.toThrow("L1 未推进");
    expect(laterCalled).toBe(false);
  });
  it("Core hasFullBacklog=true 且 hasMore=false 仍继续处理", async () => {
    let calls=0; let messagesAtL2=0;
    const result=await drainPreparedMemory(["s"],{
      l1:async () => {calls++;return {processedCount:10,hasMore:false,hasFullBacklog:calls<4,profileScopes:["p"]};},
      l2:async () => {messagesAtL2=calls*10;},l3:async () => {},
    },40);
    expect(result.processedMessages).toBe(40);expect(messagesAtL2).toBe(40);
  });
  it("即使 L1 声称没有后续，也不能在数量不足时生成 L2", async () => {
    let laterCalled=false;
    await expect(drainPreparedMemory(["s"],{
      l1:async () => ({processedCount:10,hasMore:false,hasFullBacklog:false,profileScopes:["p"]}),
      l2:async () => {laterCalled=true;},l3:async () => {laterCalled=true;},
    },40)).rejects.toThrow("L1 未处理全部消息");
    expect(laterCalled).toBe(false);
  });
});
