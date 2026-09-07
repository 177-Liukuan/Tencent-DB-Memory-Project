import { Histogram, Counter } from './metrics.js';
export class CheckoutService {
    readonly latency = new Histogram();
    readonly failures = new Counter();
    async run<T>(work: () => Promise<T>) {
        const start = performance.now();
        try {
            return await work();
        }
        catch (e) {
            this.failures.inc();
            throw e;
        }
        finally {
            this.latency.observe(performance.now() - start);
        }
    }
}

