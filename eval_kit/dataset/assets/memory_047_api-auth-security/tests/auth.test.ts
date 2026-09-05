import test from 'node:test';
import assert from 'node:assert/strict';
import { sign, verify, bearer } from '../src/auth.js';
test('signature roundtrip', () => { const s = sign('p', 'k'); assert.equal(verify('p', s, 'k'), true); assert.equal(verify('x', s, 'k'), false); });
test('bearer rejects other schemes', () => assert.equal(bearer('Basic x'), null));

