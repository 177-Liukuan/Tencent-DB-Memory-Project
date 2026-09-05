import { randomUUID } from 'node:crypto';
import type { RedisLike } from './redis-like.js';
export class DistributedLock {
    constructor(private redis: RedisLike, private prefix = 'lock:') { }
    async acquire(resource: string, ttlMs: number) { const token = randomUUID(); const ok = await this.redis.set(`${this.prefix}${resource}`, token, ttlMs, true); return ok ? { resource, token } : null; }
    async release(lock: {
        resource: string;
        token: string;
    }) { return this.redis.delIfValue(`${this.prefix}${lock.resource}`, lock.token); }
}

