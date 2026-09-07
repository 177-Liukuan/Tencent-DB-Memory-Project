export interface BackfillStore {
    next(after: string | undefined, limit: number): Promise<{
        id: string;
    }[]>;
    update(id: string): Promise<void>;
}
export async function runBackfill(store: BackfillStore, batchSize = 100) {
    let cursor: string | undefined;
    let updated = 0;
    for (;;) {
        const rows = await store.next(cursor, batchSize);
        if (rows.length === 0)
            break;
        for (const row of rows) {
            await store.update(row.id);
            updated++;
            cursor = row.id;
        }
    }
    return updated;
}
