// 只读最近全量实验，核对页面是否使用配对统计；不调用模型、不改运行记录。
(async page => {
  const origin = "http://127.0.0.1:4173";
  const experiment = "pilot-2026-09-07T10-07-49-526Z";
  const check = (value, message) => { if (!value) throw new Error(message); };
  await page.goto(`${origin}/?view=results&experiment=${experiment}&suite=main`);
  await page.locator("#case-list .case-row").first().waitFor();
  check((await page.locator("#dashboard").innerText()).includes("同题对比"), "主指标必须明确同题有效观测范围");
  const scope = await page.locator("#comparison-scope").innerText();
  check(scope.includes("259") && scope.includes("26") && scope.includes("199") && scope.includes("60"), "配对范围应为 259 对，正199负60，排除26对");
  const metrics = await page.locator("#metrics").innerText();
  for (const fraction of ["194 / 199", "193 / 199", "138 / 194", "129 / 193", "25 / 60"]) {
    check(metrics.includes(fraction), `主卡片缺少配对分子/分母：${fraction}`);
  }
  check(metrics.includes("本轮未测量"), "首次观测模式不能冒充完成任务延迟");
  const health = await page.locator("#observation-health").innerText();
  for (const fraction of ["264 / 285", "277 / 285", "21 / 285", "8 / 285"]) check(health.includes(fraction), `缺少全部运行观测情况：${fraction}`);
  await page.locator("#comparison-filter").selectOption("excluded");
  check((await page.locator("#case-count").innerText()).startsWith("26 / 285"), "排除筛选不能删除有效一侧的原记录");
  check(await page.locator("#metrics").innerText() === metrics, "列表筛选不能偷偷改变主指标");
  await page.locator("#case-list .case-row").first().click();
  await page.locator("#case-dialog .variant-detail").first().waitFor();
  check((await page.locator("#case-dialog").innerText()).includes("本题未纳入主对比"), "详情必须说明整对排除而不是两边都失败");
  check(await page.locator("#case-dialog .variant-detail").count() === 2, "排除后仍保留两组详情");
  await page.keyboard.press("Escape");
  await page.locator("#comparison-filter").selectOption("included");
  check((await page.locator("#case-count").innerText()).startsWith("259 / 285"), "纳入筛选范围错误");
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "手机页面横向溢出");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator("#clear").click();
  return { passed: true, checks: ["同题范围", "分子分母", "观测完整性", "排除筛选与详情", "不测量延迟", "手机布局"] };
})
