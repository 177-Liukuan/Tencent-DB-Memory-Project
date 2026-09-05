import type { RedisLike } from '../redis-like.js';
export class OrderCache {
    constructor(private redis: RedisLike, private prefix = 'orders:') { }
    async get(id: string) { const raw = await this.redis.get(`${this.prefix}${id}`); return raw ? JSON.parse(raw) : null; }
    async set(id: string, value: unknown, ttlMs: number) { await this.redis.set(`${this.prefix}${id}`, JSON.stringify(value), ttlMs); }
}

