export async function waitForHttp(url: string, timeoutMs = 30_000, intervalMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // systemctl 的 active 只代表进程已创建，不保证端口已监听；这里只重试只读启动探测。
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url,{signal:AbortSignal.timeout(Math.min(3000,Math.max(1,deadline-Date.now())))});
      await response.body?.cancel();
      if (response.ok || response.status === 401) return;
    } catch { /* 启动期间连接拒绝，继续等到明确的截止时间。 */ }
    await new Promise(resolve=>setTimeout(resolve,intervalMs));
  }
  throw new Error("服务启动超时: " + url);
}
