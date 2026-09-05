import { NotFoundError } from './errors.js';
import type { CreateOrderInput, Order, OrderRepository } from './types.js';
export class OrderService {
    constructor(private readonly repo: OrderRepository) { }
    async detail(id: string): Promise<Order> {
        const order = await this.repo.get(id);
        if (!order)
            throw new NotFoundError('order', id);
        return order;
    }
    async list(offset: number, limit: number): Promise<Order[]> {
        if (offset < 0 || limit <= 0)
            throw new Error('invalid pagination');
        return this.repo.list(offset, limit);
    }
    async create(input: CreateOrderInput): Promise<Order> {
        if (!input.customerId)
            throw new Error('customerId required');
        if (!Number.isInteger(input.totalCents) || input.totalCents < 0)
            throw new Error('invalid total');
        return this.repo.create(input);
    }
}

