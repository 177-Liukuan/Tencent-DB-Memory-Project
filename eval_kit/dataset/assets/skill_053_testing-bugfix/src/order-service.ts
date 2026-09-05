import { total, type Line } from './price.js';
import type { Clock } from './clock.js';
export class OrderService {
    constructor(private clock: Clock) { }
    quote(lines: readonly Line[], discount = 0) { const amount = total(lines, discount); return { amount, quotedAt: this.clock.now().toISOString() }; }
}

