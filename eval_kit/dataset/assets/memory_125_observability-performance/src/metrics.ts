export class Counter {
    private value = 0;
    inc(by = 1) { this.value += by; }
    read() { return this.value; }
}
export class Histogram {
    private values: number[] = [];
    observe(v: number) { this.values.push(v); }
    percentile(p: number) {
        if (!this.values.length)
            return 0;
        const s = [...this.values].sort((a, b) => a - b);
        return s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))];
    }
}
