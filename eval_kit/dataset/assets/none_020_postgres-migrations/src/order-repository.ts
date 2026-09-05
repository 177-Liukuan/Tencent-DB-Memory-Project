export async function findOrder(db: { query(sql: string, args?: unknown[]): Promise<unknown> }, id: string) {
  return db.query('SELECT * FROM orders WHERE id = $1', [id]);
}
