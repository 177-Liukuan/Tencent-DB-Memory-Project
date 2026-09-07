export class CounterLimiter {
    private rows = new Map<string, {
        count: number;
        reset: number;
    }>();
    allow(key: string, max: number, now = Date.now()) {
        let r = this.rows.get(key);
        if (!r || r.reset < now) {
            r = { count: 0, reset: now + 60000 };
            this.rows.set(key, r);
        }
        r.count++;
        return r.count <= max;
    }
}
