export interface Queryable {
    query<T>(sql: string, params: readonly unknown[]): Promise<{
        rows: T[];
    }>;
}
export class OrderRepository {
    constructor(private db: Queryable) { }
    async findByCustomer(customerId: string, limit = 50) { const q = 'SELECT id, status, total_minor FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT $2'; return (await this.db.query(q, [customerId, limit])).rows; }
}
