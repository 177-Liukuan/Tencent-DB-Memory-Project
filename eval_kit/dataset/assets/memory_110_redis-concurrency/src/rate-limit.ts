import type { RedisLike } from './redis-like.js';
export class FixedWindowLimiter {
    constructor(private redis: RedisLike) { }
    async allow(key: string, max: number) { return await this.redis.incr(`rate:${key}`) <= max; }
}
