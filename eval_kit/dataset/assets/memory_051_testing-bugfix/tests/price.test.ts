import test from 'node:test';
import assert from 'node:assert/strict';
import { subtotal, total } from '../src/price.js';
test('subtotal uses integer cents', () => assert.equal(subtotal([{ unitCents: 199, quantity: 3 }]), 597));
test('discount rounds to nearest cent', () => assert.equal(total([{ unitCents: 999, quantity: 1 }], 500), 949));

