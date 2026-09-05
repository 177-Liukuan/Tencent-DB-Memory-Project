import { describe, expect, it } from 'vitest';
import { getOrder } from '../src/order-service';
describe('getOrder', () => { it('returns an order', async () => expect(await getOrder('o1')).not.toBeNull()); });
