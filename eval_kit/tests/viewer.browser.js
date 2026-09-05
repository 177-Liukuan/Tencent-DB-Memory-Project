// 通过 Playwright 的 browser_run_code 工具运行；只读现有实验，不调用模型或修改业务数据。
(async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  await page.goto("http://127.0.0.1:4173/?view=results");
  await page.getByRole("heading", { name: "工具调用评测", exact: true }).waitFor({ timeout: 5000 });
  await page.locator("#case-list .case-row").first().waitFor();
  check(await page.locator("#metrics .metric-card").count() === 4, "应显示四个核心对比指标");
  await page.locator("#case-list .case-row").first().click();
  await page.locator("#case-dialog[open] .variant-detail").first().waitFor();
  check(await page.locator(".variant-detail").count() === 2, "详情应并排显示两组结果");
  check((await page.locator("#case-dialog").innerText()).includes("Bridge"), "应说明观测来源");
  await page.keyboard.press("Escape");
  check(!(await page.locator("#case-dialog").isVisible()), "Escape 应关闭详情");
  await page.getByLabel("搜索案例").fill("no-such-case-xyz");
  await page.getByText("没有符合筛选条件的案例", { exact: true }).waitFor();
  await page.getByRole("button", { name: "清空筛选", exact: true }).click();
  await page.locator("#case-list .case-row").first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "手机页面不能横向溢出");
  await page.setViewportSize({ width: 1440, height: 1000 });

  // 故障注入仅替换 Viewer 的 HTTP 响应，不影响业务 Bridge，也不参与任何评测指标。
  const experiments = await (await page.request.get("http://127.0.0.1:4173/api/experiments")).json();
  const experiment = experiments[0].experiment_id;
  const endpoint = `http://127.0.0.1:4173/api/experiments/${experiment}/overview`;
  const original = await (await page.request.get(endpoint)).json();
  const source = original.items.find(r => r.observation_valid);
  const fixture = JSON.parse(JSON.stringify(original));
  fixture.items = Array.from({ length: 60 }, (_, index) => ({ ...source,
    case_id: `case-${String(Math.floor(index / 2)).padStart(2, "0")}`, variant: index % 2 ? "native" : "baseline",
    run_id: `fixture-${index}`, repeat: 1, query: "Pagination test", outcome: index === 0 ? "invalid" : "correct" }));
  await page.route("**/overview*", route => route.fulfill({ json: fixture }));
  await page.getByRole("button", { name: "刷新结果" }).click();
  await page.getByText("1 / 2 页", { exact: true }).waitFor();
  check(await page.locator(".case-row").count() === 25, "首屏最多渲染 25 个案例");
  await page.getByRole("button", { name: "下一页" }).click();
  check(await page.locator(".case-row").count() === 5, "第二页应显示剩余案例");
  await page.getByLabel("调用情况").selectOption("invalid");
  check(await page.locator(".case-row").count() === 1, "异常筛选应按任一方案匹配，并重置页码");
  await page.unroute("**/overview*");
  await page.getByRole("button", { name: "清空筛选", exact: true }).click();
  await page.getByRole("button", { name: "刷新结果" }).click();
  await page.locator(".case-row").first().waitFor();

  await page.route("**/runs/*", async route => {
    const result = await (await route.fetch()).json();
    await route.fulfill({ json: { ...result, final_answer: '<img src="x" onerror="window.viewerXss=true">' } });
  });
  await page.locator(".case-row").first().click();
  await page.locator("#case-dialog .answer").first().waitFor();
  check((await page.locator("#case-dialog .answer").first().innerText()).includes("<img"), "回答应按原始文本显示");
  check(await page.locator("#case-dialog img").count() === 0, "回答中的 HTML 不能成为 DOM");
  check(await page.evaluate(() => !window.viewerXss), "回答不能执行脚本");
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.querySelector("#case-dialog").scrollWidth <= document.querySelector("#case-dialog").clientWidth), "手机详情不能横向溢出");
  await page.keyboard.press("Escape"); await page.unroute("**/runs/*");
  await page.setViewportSize({ width: 1440, height: 1000 });

  await page.route("**/api/experiments", route => route.fulfill({ status: 503, json: { error: "test: read unavailable" } }));
  await page.getByRole("button", { name: "刷新结果" }).click();
  await page.getByRole("alert").filter({ hasText: "test: read unavailable" }).waitFor();
  check(!(await page.locator("#dashboard").isVisible()), "读取失败时不能把旧指标留作当前结果");
  await page.unroute("**/api/experiments");
  await page.getByRole("button", { name: "刷新结果" }).click();
  await page.locator(".case-row").first().waitFor();

  let release;
  let seen;
  const arrived = new Promise(resolve => { seen = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let finished;
  const fulfilled = new Promise(resolve => { finished = resolve; });
  let first = true;
  await page.route("**/overview*", async route => {
    const data = JSON.parse(JSON.stringify(original));
    if (first) {
      first = false; seen(); await held; data.model = "STALE MODEL";
      await route.fulfill({ json: data }); finished();
    } else { data.model = "LATEST MODEL"; await route.fulfill({ json: data }); }
  });
  await page.getByRole("button", { name: "刷新结果" }).click();
  await arrived;
  // 网络请求尚未结束时再次选择实验，较晚返回的旧响应不能覆盖新响应。
  await page.locator("#experiment").dispatchEvent("change");
  await page.getByText("LATEST MODEL", { exact: true }).waitFor();
  release(); await fulfilled;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  check(await page.locator("#model").innerText() === "LATEST MODEL", "旧请求不能覆盖最新实验");
  await page.unroute("**/overview*");
  await page.getByRole("button", { name: "刷新结果" }).click();
  await page.locator("#model").filter({ hasText: original.model }).waitFor();
  return { passed: true, checks: ["新格式总览", "并排详情", "键盘关闭", "搜索及清空", "手机布局", "分页", "异常筛选", "XSS", "读取失败及重试", "快速切换响应顺序"] };
})
