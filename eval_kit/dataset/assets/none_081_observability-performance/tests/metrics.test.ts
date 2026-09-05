import test from 'node:test';
import assert from 'node:assert/strict';
import { Histogram } from '../src/metrics.js';
test('percentile uses observed values', () => { const h = new Histogram(); [10, 20, 30, 40].forEach(x => h.observe(x)); assert.equal(h.percentile(.5), 20); });

