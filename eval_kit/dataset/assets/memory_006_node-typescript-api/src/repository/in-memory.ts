import type { CreateOrderInput, Order, OrderRepository } from '../types.js';
export class InMemoryOrderRepository implements OrderRepository {
    private readonly rows = new Map<string, Order>();
    private seq = 1;
    async get(id: string) { return this.rows.get(id) ?? null; }
    async list(offset: number, limit: number) { return [...this.rows.values()].slice(offset, offset + limit); }
    async create(input: CreateOrderInput) { const id = `ord-${this.seq++}`; const row: Order = { id, status: 'created', ...input }; this.rows.set(id, row); return row; }
}

