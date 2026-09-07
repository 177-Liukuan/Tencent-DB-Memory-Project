import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBaseline, normalizeNative } from '../src/normalize.js';
test('normalizes baseline curl url', () => assert.equal(normalizeBaseline('curl http://proxy/skill_view?id=x'), 'skill_view'));
test('rejects unknown native tool', () => assert.equal(normalizeNative('Bash'), null));

