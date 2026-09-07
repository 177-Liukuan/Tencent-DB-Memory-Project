import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderService } from '../src/order-service.js';
import { InMemoryOrderRepository } from '../src/repository/in-memory.js';
test('create and read an order', async () => { const service = new OrderService(new InMemoryOrderRepository()); const made = await service.create({ customerId: 'c1', totalCents: 1299 }); assert.equal((await service.detail(made.id)).totalCents, 1299); });
test('rejects invalid pagination', async () => { const service = new OrderService(new InMemoryOrderRepository()); await assert.rejects(() => service.list(-1, 10)); });
