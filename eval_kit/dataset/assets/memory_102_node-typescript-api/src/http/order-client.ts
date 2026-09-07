import type { Order } from '../types.js';
export interface HttpTransport {
    request(url: string, init: {
        method: string;
        signal?: AbortSignal;
    }): Promise<{
        status: number;
        json(): Promise<unknown>;
    }>;
}
export class OrderClient {
    constructor(private readonly baseUrl: string, private readonly transport: HttpTransport) { }
    async getOrder(id: string, signal?: AbortSignal): Promise<Order> {
        const response = await this.transport.request(`${this.baseUrl}/orders/${encodeURIComponent(id)}`, { method: 'GET', signal });
        if (response.status !== 200)
            throw new Error(`unexpected status ${response.status}`);
        return await response.json() as Order;
    }
    async createOrder(body: unknown, signal?: AbortSignal): Promise<unknown> {
        void body;
        const response = await this.transport.request(`${this.baseUrl}/orders`, { method: 'POST', signal });
        return response.json();
    }
}
