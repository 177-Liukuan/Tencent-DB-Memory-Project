import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldPromote, summarize } from '../scripts/health-gate.mjs';
test('promotion requires acceptable samples', () => {
    assert.equal(shouldPromote([{ ok: true }, { ok: true }]), true);
    assert.equal(shouldPromote([{ ok: true }, { ok: false }]), false);
});
test('summary counts outcomes', () => {
    assert.deepEqual(summarize([{ ok: true }, { ok: false }]), { total: 2, ok: 1, failed: 1 });
});

