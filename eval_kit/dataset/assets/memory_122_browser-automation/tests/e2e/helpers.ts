import type { Page } from '@playwright/test';
export async function signIn(page: Page, email: string, password: string) {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('status').waitFor();
}
export async function readOrders(page: Page) {
    await page.goto('/orders.html');
    const rows = page.getByRole('table', { name: 'Orders' }).getByRole('row');
    const count = await rows.count();
    const result: string[][] = [];
    for (let i = 1; i < count; i += 1) {
        result.push(await rows.nth(i).getByRole('cell').allTextContents());
    }
    return result;
}
