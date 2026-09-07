export class SessionManager {
    private active = new Map<string, {
        profile: string;
        startedAt: number;
    }>();
    open(id: string, profile: string) {
        if (this.active.has(id))
            throw new Error(`session already exists: ${id}`);
        this.active.set(id, { profile, startedAt: Date.now() });
    }
    close(id: string) {
        return this.active.delete(id);
    }
    get(id: string) {
        return this.active.get(id) ?? null;
    }
    list() {
        return [...this.active.entries()].map(([id, value]) => ({ id, ...value }));
    }
    clear() {
        this.active.clear();
    }
}
