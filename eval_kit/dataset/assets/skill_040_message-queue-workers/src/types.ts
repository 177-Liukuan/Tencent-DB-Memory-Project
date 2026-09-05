export type BillingEvent = {
    eventId: string;
    accountId: string;
    kind: 'invoice.paid' | 'refund.completed';
    amountMinor: number;
};
export interface Message<T> {
    id: string;
    attempt: number;
    payload: T;
}
;

