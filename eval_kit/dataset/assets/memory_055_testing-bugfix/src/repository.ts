export class MemoryRepository<T extends {
    id: string;
}> {
    private rows = new Map<string, T>();
    save(row: T) { this.rows.set(row.id, structuredClone(row)); }
    get(id: string) { const r = this.rows.get(id); return r ? structuredClone(r) : null; }
    clear() { this.rows.clear(); }
}

