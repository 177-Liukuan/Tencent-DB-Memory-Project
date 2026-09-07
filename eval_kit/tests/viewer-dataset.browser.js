// Playwright browser_run_code 的 filename 入口。只替换页面测试响应，不写数据集或运行评测。
(async (page) => {
  const check = (value, message) => { if (!value) throw new Error(message); };
  const origin = "http://127.0.0.1:4173";
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on("pageerror", onError);
  try {
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.goto(origin);
    await page.locator('#nav-dataset').click();
    await page.locator("#dataset-content").waitFor();
    const actual = await (await page.request.get(`${origin}/api/dataset`)).json();
    check(await page.locator("#dataset-stats .stat-value").first().innerText() === String(actual.items.length), "统计必须来自当前数据集");
    check(actual.summary.tasks === actual.summary.positive + actual.summary.negative, "正负样本数必须等于总任务数");
    check(await page.locator("#nav-dataset").getAttribute("aria-current") === "page", "首页应为数据集");
    check(await page.locator(".dataset-row").count() === Math.min(20, actual.items.length), "列表必须分页");
    check(await page.locator('#dataset-difficulty, #dataset-difficulties, .difficulty-button').count() === 0, "不再展示难度图表或筛选");
    check(await page.locator('.family-count-button').count() === actual.distributions.families.length, "每个任务类别应有数量条形图");
    for (const item of actual.distributions.families) {
      const bar = page.locator(`.family-count-button[data-family="${item.name}"]`);
      check(Number(await bar.locator('strong').innerText()) === item.count, "条形图显示实际类别数量");
      const fill = await bar.locator('.family-count-fill').evaluate(el => getComputedStyle(el).backgroundColor);
      const stroke = await page.locator(`.donut-segment.${item.name}`).evaluate(el => getComputedStyle(el).stroke);
      check(fill === stroke, "条形图与环形图使用同一类别颜色");
    }
    const family = actual.distributions.families.find(f => f.name === "memory") ?? actual.distributions.families[0];
    await page.locator(`.legend-button[data-family="${family.name}"]`).click();
    check(await page.locator("#dataset-family").inputValue() === family.name, "图例应联动类别筛选");
    check((await page.locator("#dataset-count").innerText()).startsWith(`${family.count} /`), "类别筛选数量必须正确");
    const familyBar = page.locator(`.family-count-button[data-family="${family.name}"]`);
    check(await familyBar.getAttribute('aria-pressed') === 'true', "图例与条形图选中状态同步");
    await familyBar.click();
    check(await page.locator('#dataset-family').inputValue() === '', "再次点击类别条形图取消筛选");
    await familyBar.click();
    check(await page.locator('#dataset-family').inputValue() === family.name, "条形图支持点击筛选");
    const sample = actual.items.find(i => i.task_group === family.name);
    const scenario = sample.scenario_id ?? "unknown";
    await page.locator(`.scenario-button[data-scenario="${scenario}"]`).click();
    const filtered = actual.items.filter(i => i.task_group === family.name && (i.scenario_id ?? "unknown") === scenario);
    check((await page.locator("#dataset-count").innerText()).startsWith(`${filtered.length} /`), "类别与场景筛选取交集");
    check(await page.locator('.dataset-row').first().locator('.dataset-row-tags .dataset-pill').count() === 1, "列表只保留类别标签");
    await page.locator(".dataset-row").first().click();
    check((await page.locator(".task-query p").innerText()) === filtered[0].query, "详情需保留完整 Query");
    check(await page.locator('#dataset-detail-body > .task-meta').first().locator('.dataset-pill').count() === 3, "详情不再展示难度标签");
    check((await page.locator("#dataset-detail-body").innerText()).includes("完整任务数据"), "应提供完整标签和检查规则");
    await page.keyboard.press("Escape");
    check(!(await page.locator("#dataset-dialog").isVisible()), "Esc 关闭任务详情");
    await page.locator("#dataset-clear").click();
    await page.locator("#dataset-search").fill("__no_such_task_for_browser_check__");
    check(await page.locator(".dataset-row").count() === 0, "搜索无匹配时显示空状态");
    await page.locator("#dataset-clear").click();
    if (actual.items.length > 20) {
      await page.locator("#dataset-next").click();
      check((await page.locator(".dataset-row").first().innerText()).includes(actual.items[20].case_id), "第二页应从第21条任务开始");
      await page.locator("#dataset-prev").click();
    }
    for (const width of [390, 768, 1100]) {
      await page.setViewportSize({ width, height: 900 });
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px 页面不能横向溢出`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".dataset-row").first().click();
    check(await page.evaluate(() => document.querySelector("#dataset-dialog").scrollWidth <= document.querySelector("#dataset-dialog").clientWidth), "手机任务详情不能横向溢出");
    await page.locator("#dataset-close").click();
    await page.locator("#nav-results").click();
    await page.locator("#results-view").waitFor();
    check(await page.locator("#nav-results").getAttribute("aria-current") === "page", "结果导航选中状态");
    await page.locator("#nav-dataset").click();
    await page.locator("#dataset-content").waitFor();
    await page.setViewportSize({ width: 1440, height: 1050 });

    const fixture = JSON.parse(JSON.stringify(actual));
    fixture.items[0].query = '<img src="x" onerror="window.datasetXss=true">';
    fixture.items[0].reason = '该任务依赖历史约定；<img src="x" onerror="window.reasonXss=true">';
    fixture.items[0].expected_tool_sequence = ["skill_search", "skill_view", "skill_view"];
    delete fixture.items[0].allowed_sequences;
    fixture.items[0].should_call = true;
    await page.route("**/api/dataset", route => route.fulfill({ json: fixture }));
    await page.locator("#dataset-refresh").click();
    await page.locator(".dataset-query").first().filter({ hasText: "<img" }).waitFor();
    await page.locator(".dataset-row").first().click();
    check(await page.locator("#dataset-dialog img").count() === 0, "Query中的HTML不能变成DOM");
    check(await page.evaluate(() => !window.datasetXss), "Query不能执行脚本");
    check(await page.locator(".task-reason p").innerText() === fixture.items[0].reason, "标注理由必须单独展示并按文本渲染");
    check(await page.evaluate(() => !window.reasonXss), "标注理由不能执行脚本");
    const sequence = page.locator("#dataset-detail-body details").filter({ has: page.locator('summary', { hasText: /^预期调用顺序$/ }) });
    check((await sequence.innerText()).match(/skill_view/g).length === 2, "详情不能把调用序列中的重复工具去重");
    await page.keyboard.press("Escape");
    await page.unroute("**/api/dataset");

    await page.route("**/api/dataset", route => route.fulfill({ status: 422, json: { error: "test: invalid dataset" } }));
    await page.locator("#dataset-refresh").click();
    await page.locator("#dataset-notice").filter({ hasText: "invalid dataset" }).waitFor();
    check(!(await page.locator("#dataset-content").isVisible()), "读取失败不能保留旧统计作为当前结果");
    await page.unroute("**/api/dataset");
    await page.locator("#dataset-refresh").click();
    await page.locator("#dataset-content").waitFor();
    check(await page.locator("#dataset-notice").isHidden(), "刷新成功应移除错误提示");
    check(errors.length === 0, `不能有脚本异常：${errors.join("; ")}`);
    await page.evaluate(() => scrollTo(0, 0));
    return { passed: true, tasks: actual.summary.tasks, checks: ["实时数量", "类别条形图及配色", "分类图例筛选", "类别与场景交集", "移除难度标签", "完整Query和规则", "搜索空状态", "分页", "手机平板布局", "页面切换", "XSS", "重复工具顺序", "读取失败重试"] };
  } finally {
    await page.unroute("**/api/dataset");
    page.off("pageerror", onError);
  }
})
