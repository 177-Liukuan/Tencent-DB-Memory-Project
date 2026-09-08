// 配合 latency-viewer-fixture.ts 的临时服务执行，不依赖正式实验或模型调用。
async (page) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.locator("#latency-table tbody tr").first().waitFor();
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const text = await page.locator("#metrics").innerText();
  assert(text.includes("3.000 s") && text.includes("2.000 s") && text.includes("2.000 s²")
    && text.includes("1.414 s") && text.includes("-33.3%"), "总体均值、方差、标准差或变化率不正确");
  assert(await page.locator("#tool-breakdown").isHidden(), "延迟实验不能展示工具得分");
  assert(await page.locator("#latency-table tbody tr").count() === 2, "排除任务的诊断记录缺失");
  await page.locator(".latency-trajectory summary").first().click();
  assert((await page.locator(".latency-trajectory").first().innerText()).includes("2 次运行：tdai_memory_search"), "缺少调用轨迹");
  await page.locator(".case-row").first().click();
  await page.locator("#case-dialog .variant-detail").first().waitFor();
  const detail = await page.locator("#case-dialog").textContent();
  assert(detail.includes("已经返回最终响应") && detail.includes("不纳入正式延迟汇总"), "详情与排除状态未衔接");
  await page.locator("#case-dialog").evaluate(dialog => dialog.close());
  await page.setViewportSize({width:390,height:844});
  assert(!(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)), "移动端页面溢出");
  assert(errors.length === 0, errors.join("\n"));
  return {metrics:text,desktop:true,mobile:true,details:true,errors};
}
