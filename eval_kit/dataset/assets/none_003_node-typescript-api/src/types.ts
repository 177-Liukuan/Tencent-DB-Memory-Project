export interface Order {
    id: string;
    customerId: string;
    totalCents: number;
    status: 'created' | 'paid' | 'cancelled';
}
export interface CreateOrderInput {
    customerId: string;
    totalCents: number;
    couponCode?: string;
}
export interface OrderRepository {
    get(id: string): Promise<Order | null>;
    list(offset: number, limit: number): Promise<Order[]>;
    create(input: CreateOrderInput): Promise<Order>;
}

