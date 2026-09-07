import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderClient } from '../src/http/order-client.js';
test('encodes id in request path', async () => { let seen = ''; const client = new OrderClient('https://orders.local', { async request(url) { seen = url; return { status: 200, async json() { return { id: 'a/b', customerId: 'c', totalCents: 1, status: 'created' }; } }; } }); await client.getOrder('a/b'); assert.match(seen, /a%2Fb$/); });
