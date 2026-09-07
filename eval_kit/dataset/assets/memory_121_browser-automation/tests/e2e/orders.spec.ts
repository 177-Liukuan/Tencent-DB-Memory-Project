import { test, expect } from '@playwright/test';
test('orders table is visible', async ({ page }) => { await page.goto('/orders.html'); await expect(page.getByRole('table', { name: 'Orders' })).toBeVisible(); });
