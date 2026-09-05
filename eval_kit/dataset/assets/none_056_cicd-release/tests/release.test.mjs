import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
test('release plan is valid json', () => { const out = execFileSync('node', ['scripts/release-plan.mjs'], { encoding: 'utf8' }); const x = JSON.parse(out); assert.equal(x.steps[0], 'verify'); });

