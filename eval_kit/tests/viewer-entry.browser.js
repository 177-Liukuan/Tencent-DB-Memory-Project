(async page => {
  const tab = await page.context().newPage();
  const check = (value, message) => { if (!value) throw new Error(message); };
  try {
    await tab.goto("http://127.0.0.1:4173/?view=review");
    await tab.locator('#results-view').waitFor({ timeout: 3000 });
    check(await tab.locator('#nav-results').getAttribute('aria-current') === 'page', '外部链接默认进入结果页');
    await tab.locator('#nav-review').click();
    await tab.locator('#review-form').waitFor();
    await tab.reload();
    await tab.locator('#results-view').waitFor({ timeout: 3000 });
    await tab.locator('#nav-review').click();
    for (const width of [1440, 1000, 390]) {
      await tab.setViewportSize({ width, height: 1000 });
      const card = tab.locator('[data-tool="tdai_conversation_search"]');
      await card.hover();
      const tip = card.locator('[role="tooltip"]');
      check(await tip.isVisible(), '说明应显示');
      check(await tip.evaluate(el => {
        const r = el.getBoundingClientRect();
        return [r.left + 3, r.right - 3].every(x => el.contains(document.elementFromPoint(x, r.top + r.height / 2)));
      }), `${width}px 说明左右两侧不能被面板裁切或遮挡`);
    }
    return { passed: true };
  } finally { await tab.close({ runBeforeUnload: false }); }
})
