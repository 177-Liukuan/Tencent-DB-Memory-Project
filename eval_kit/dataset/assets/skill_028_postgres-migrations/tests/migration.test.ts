import test from 'node:test';
import assert from 'node:assert/strict';
import { runBackfill } from '../scripts/backfill.js';
test('backfill visits every row', async () => { const ids = ['a', 'b', 'c']; const seen: string[] = []; const n = await runBackfill({ async next(after, limit) { const start = after ? ids.indexOf(after) + 1 : 0; return ids.slice(start, start + limit).map(id => ({ id })); }, async update(id) { seen.push(id); } }, 2); assert.equal(n, 3); assert.deepEqual(seen, ids); });

