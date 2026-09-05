export interface Order { id: string; totalCents: number }
export async function getOrder(id: string): Promise<Order | null> {
  return id ? { id, totalCents: 1299 } : null;
}
