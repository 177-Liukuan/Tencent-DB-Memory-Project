// 只修改浏览器草稿，不保存正式数据；验证鼠标与键盘的说明框生命周期。
(async page => {
  const tab = await page.context().newPage();
  const check = (value, message) => { if (!value) throw new Error(message); };
  try {
    await tab.goto("http://127.0.0.1:4173/?view=review");
    await tab.locator('#nav-review').click();
    const card = tab.locator('[data-tool="tdai_memory_search"]');
    const tip = card.locator('[role="tooltip"]');
    const button = card.locator('button');
    await card.hover();
    check(await tip.isVisible(), "悬停应显示说明");
    const selected = await button.getAttribute("aria-pressed");
    await button.click();
    check(await button.getAttribute("aria-pressed") !== selected, "点击仍须切换工具选择");
    check(!await tip.isVisible(), "点击选择后应立即关闭说明");
    await tab.locator('#review-query').hover();
    check(!await tip.isVisible(), "鼠标移走后不能因点击焦点残留说明");
    await card.hover();
    check(await tip.isVisible(), "重新悬停应能再次查看说明");
    await tab.locator('#review-query').click();
    await button.focus();
    await tab.keyboard.press('Shift+Tab');
    check(await card.evaluate(el => el.matches(':focus-visible')), "键盘导航应聚焦工具卡片");
    check(await tip.isVisible(), "键盘聚焦仍应显示说明");
    await tab.keyboard.press('Tab');
    await tab.keyboard.press('Tab');
    check(!await tip.isVisible(), "键盘离开后应关闭说明");
    return { passed: true };
  } finally { await tab.close({ runBeforeUnload: false }); }
})
