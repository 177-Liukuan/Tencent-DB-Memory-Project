import { test as base } from '@playwright/test';
export const test = base.extend<{
    account: {
        email: string;
        password: string;
    };
}>({ account: async ({}, use) => { await use({ email: 'demo@example.test', password: 'secret' }); } });
export { expect } from '@playwright/test';
