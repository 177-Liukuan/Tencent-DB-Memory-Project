export type OutboxRow = {
    id: string;
    topic: string;
    payload: string;
    publishedAt?: number;
};
export class Outbox {
    private rows: OutboxRow[] = [];
    add(row: OutboxRow) { this.rows.push(row); }
    pending() { return this.rows.filter(x => !x.publishedAt); }
    markPublished(id: string) {
        const row = this.rows.find(x => x.id === id);
        if (row)
            row.publishedAt = Date.now();
    }
}
