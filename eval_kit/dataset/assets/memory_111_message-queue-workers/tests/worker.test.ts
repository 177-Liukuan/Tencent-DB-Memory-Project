import test from 'node:test';
import assert from 'node:assert/strict';
import { BillingWorker } from '../src/worker.js';
import { IdempotencyStore } from '../src/idempotency.js';
test('duplicate event is not applied twice', async () => { let calls = 0; const w = new BillingWorker(new IdempotencyStore(), async () => { calls++; }); const m = { id: 'm1', attempt: 0, payload: { eventId: 'e1', accountId: 'a', kind: 'invoice.paid' as const, amountMinor: 10 } }; assert.equal(await w.handle(m), 'processed'); assert.equal(await w.handle(m), 'duplicate'); assert.equal(calls, 1); });
