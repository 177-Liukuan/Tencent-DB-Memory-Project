export class IdempotencyStore {
    private seen = new Set<string>();
    has(id: string) { return this.seen.has(id); }
    mark(id: string) { this.seen.add(id); }
}
