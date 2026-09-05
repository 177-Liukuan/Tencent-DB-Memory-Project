import type { Message, BillingEvent } from './types.js';
import { IdempotencyStore } from './idempotency.js';
export class BillingWorker {
    constructor(private ids: IdempotencyStore, private apply: (e: BillingEvent) => Promise<void>) { }
    async handle(msg: Message<BillingEvent>) {
        if (this.ids.has(msg.payload.eventId))
            return 'duplicate';
        if (msg.payload.amountMinor < 0)
            throw new Error('invalid amount');
        await this.apply(msg.payload);
        this.ids.mark(msg.payload.eventId);
        return 'processed';
    }
}

