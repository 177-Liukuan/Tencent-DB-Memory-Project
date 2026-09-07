// 只检查页面及未保存的审核预览，不写标签、不调用模型。
(async page => {
  const origin = "http://127.0.0.1:4173";
  const experiment = "pilot-2026-09-06T23-26-11-070Z";
  const check = (value, message) => { if (!value) throw new Error(message); };
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.goto(`${origin}/?view=results&experiment=${experiment}&suite=main`);
    await page.locator("#breakdown").getByText("Memory／Skill 双入口 · 正样本数").waitFor({ state: "attached" });
    await page.locator("#breakdown").evaluate(el => { el.closest("details").open = true; });
    await page.locator("#family").selectOption("mixed");
    const overview = await (await page.request.get(`${origin}/api/experiments/${experiment}/overview`)).json();
    const count = new Set(overview.items.filter(r => r.task_group === "mixed").map(r => r.case_id)).size;
    const rows = page.locator(".case-row");
    check(await rows.count() === count, "结果过滤数量与派生组不符");
    await rows.first().click();
    await page.getByText("任务分组：Memory／Skill 双入口", { exact: true }).first().waitFor();
    await page.keyboard.press("Escape");
    await page.locator("#nav-review").click();
    await page.locator("#review-form").waitFor();
    await page.locator("#review-family-filter").selectOption("mixed");
    await page.locator("#review-list button").first().click();
    await page.waitForFunction(() => document.getElementById("review-task-group").textContent === "Memory／Skill 双入口");
    check(await page.locator('#review-family option[value="mixed"]').count() === 0, "不能增加独立 Mixed 人工标签");
    const value = JSON.parse(await page.locator("#review-json").inputValue());
    const skillTools = value.allowed_first_tools.filter(name => name.startsWith("skill_"));
    for (const name of skillTools) await page.locator(`[data-tool="${name}"] button`).click();
    await page.waitForFunction(() => document.getElementById("review-task-group").textContent === "Memory");
    check(!JSON.parse(await page.locator("#review-json").inputValue()).task_group, "派生信息不能进入标签 JSON");
    // 恢复草稿，避免测试留下未保存提示；不点击保存按钮。
    for (const name of skillTools) await page.locator(`[data-tool="${name}"] button`).click();
    await page.waitForFunction(() => document.getElementById("review-task-group").textContent === "Memory／Skill 双入口");
    await page.evaluate(() => { window.__groupTestConfirm = window.confirm; window.confirm = () => true; });
    await page.locator("#nav-results").click();
    await page.evaluate(() => { window.confirm = window.__groupTestConfirm; delete window.__groupTestConfirm; });
    check(errors.length === 0, errors.join("; "));
    return { passed: true, mixedTasksInExperiment: count, checks: ["结果四组统计", "双入口筛选", "任务详情", "审核自动重算", "派生字段不写回"] };
  } finally { page.off("pageerror", onError); }
})
