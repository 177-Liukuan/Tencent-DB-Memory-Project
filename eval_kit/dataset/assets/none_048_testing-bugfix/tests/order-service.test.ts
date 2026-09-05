import test from 'node:test';
import assert from 'node:assert/strict';
import { FixedClock } from '../src/clock.js';
import { OrderService } from '../src/order-service.js';
test('quote uses injected time', () => { const q = new OrderService(new FixedClock(new Date('2026-01-01T00:00:00Z'))).quote([{ unitCents: 100, quantity: 1 }]); assert.equal(q.quotedAt, '2026-01-01T00:00:00.000Z'); });

