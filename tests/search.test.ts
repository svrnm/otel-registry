import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matches, readParams } from '../src/scripts/search.ts';

test('readParams ignores component', () => {
  assert.deepEqual(readParams('?language=js&component=instrumentation'), { language: 'js' });
});

test('readParams reads s', () => {
  assert.equal(readParams('?s=redis').s, 'redis');
});

test('readParams treats "all" and empty values as no filter', () => {
  assert.deepEqual(readParams('?language=all&tier=&kind=all&s='), {});
});

test('readParams reads tier and kind', () => {
  assert.deepEqual(readParams('?tier=native&kind=application'), { tier: 'native', kind: 'application' });
});

test('readParams maps the old flag values onto tiers', () => {
  assert.deepEqual(readParams('?flag=native'), { tier: 'native' });
  assert.deepEqual(readParams('?flag=first_party'), { tier: 'first-party' });
  assert.deepEqual(readParams('?flag=deprecated'), {});
});

const entry = { language: 'js', kind: 'library', tiers: ['native', 'otel'] };

test('matches filters by language, tier and kind', () => {
  assert.equal(matches(entry, {}), true);
  assert.equal(matches(entry, { language: 'js' }), true);
  assert.equal(matches(entry, { language: 'go' }), false);
  assert.equal(matches(entry, { kind: 'application' }), false);
  assert.equal(matches(entry, { language: 'js', kind: 'library', tier: 'otel' }), true);
});

test('tier filter matches any option of the entry', () => {
  assert.equal(matches(entry, { tier: 'otel' }), true);
  assert.equal(matches(entry, { tier: 'third-party' }), false);
});

test('an application never matches a language filter', () => {
  assert.equal(matches({ kind: 'application', tiers: ['native'] }, { language: 'go' }), false);
});
