import { test, expect } from '@playwright/test';
test('login', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input').first().fill('demo');
  await expect(page).toHaveURL(/login/);
});
