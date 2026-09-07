export interface RedisLike {
    get(key: string): Promise<string | null>;
    set(key: string, value: string, ttlMs: number, onlyIfAbsent?: boolean): Promise<boolean>;
    delIfValue(key: string, value: string): Promise<boolean>;
    incr(key: string): Promise<number>;
}
export class MemoryRedis implements RedisLike {
    private data = new Map<string, {
        v: string;
        exp: number;
    }>();
    async get(k: string) {
        const x = this.data.get(k);
        if (!x || x.exp < Date.now()) {
            this.data.delete(k);
            return null;
        }
        return x.v;
    }
    async set(k: string, v: string, ttl: number, nx = false) {
        if (nx && await this.get(k) !== null)
            return false;
        this.data.set(k, { v, exp: Date.now() + ttl });
        return true;
    }
    async delIfValue(k: string, v: string) {
        if (await this.get(k) !== v)
            return false;
        this.data.delete(k);
        return true;
    }
    async incr(k: string) { const n = Number(await this.get(k) ?? 0) + 1; await this.set(k, String(n), 60000); return n; }
}
