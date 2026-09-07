import { test, expect } from './fixtures';
test('user can sign in', async ({ page, account }) => { await page.goto('/'); await page.getByRole('textbox', { name: 'Email' }).fill(account.email); await page.getByLabel('Password').fill(account.password); await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page.getByRole('status')).toHaveText('Signed in'); });
