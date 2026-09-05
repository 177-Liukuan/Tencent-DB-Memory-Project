import { createServer } from "node:http";
import { expect, it } from "vitest";
import { waitForHttp } from "../pipeline/readiness.js";
it("服务进程已启动但尚未就绪时等待，不把启动瞬间当成实验失败", async () => {
  let requests = 0;
  const server = createServer((_req,res)=>{res.statusCode=++requests<3?503:200;res.end("ready");});
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  try {
    const port = (server.address() as {port:number}).port;
    await waitForHttp(`http://127.0.0.1:${port}`,500,10);
    expect(requests).toBe(3);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); }
});
