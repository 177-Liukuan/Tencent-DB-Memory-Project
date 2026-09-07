import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryRedis } from '../src/redis-like.js';
import { DistributedLock } from '../src/lock.js';
test('only owner can release', async () => { const redis = new MemoryRedis(); const locks = new DistributedLock(redis); const a = await locks.acquire('order:1', 5000); assert.ok(a); assert.equal(await redis.delIfValue('lock:order:1', 'wrong'), false); assert.equal(await locks.release(a!), true); });

