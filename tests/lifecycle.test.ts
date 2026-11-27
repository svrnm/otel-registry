import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueForRemoval, parseIssue, removeOptions, renderIssue, updateMarks } from '../src/registry/lifecycle.ts';
import type { Marks } from '../src/registry/lifecycle.ts';
import type { Finding } from '../src/registry/checks.ts';

const finding = (file: string, option = 0, over: Partial<Finding> = {}): Finding => ({ file, option, check: 'abandoned', reason: 'repository a/b is archived', ...over });

test('new finding is marked today', () => {
  assert.deepEqual(updateMarks({}, [finding('libraries/js/x.yml')], '2026-11-27'), {
    'libraries/js/x.yml#0': { since: '2026-11-27', check: 'abandoned', reason: 'repository a/b is archived' },
  });
});

test('existing mark keeps its date and takes the current reason', () => {
  const prev: Marks = { 'libraries/js/x.yml#0': { since: '2026-11-01', check: 'links', reason: 'old' } };
  assert.deepEqual(updateMarks(prev, [finding('libraries/js/x.yml')], '2026-11-27')['libraries/js/x.yml#0'], {
    since: '2026-11-01', check: 'abandoned', reason: 'repository a/b is archived',
  });
});

test('cleared finding is unmarked', () => {
  const prev: Marks = { 'libraries/js/x.yml#0': { since: '2026-11-01', check: 'links', reason: 'old' } };
  assert.deepEqual(updateMarks(prev, [], '2026-11-27'), {});
});

test('due after 30 days, not after 29', () => {
  const m: Marks = { 'a.yml#0': { since: '2026-10-28', check: 'repo', reason: '' } };
  assert.deepEqual(dueForRemoval(m, '2026-11-27'), ['a.yml#0']);
  assert.deepEqual(dueForRemoval(m, '2026-11-26'), []);
});

test('dueForRemoval takes a custom threshold', () => {
  const m: Marks = { 'a.yml#0': { since: '2026-11-20', check: 'repo', reason: '' } };
  assert.deepEqual(dueForRemoval(m, '2026-11-27', 7), ['a.yml#0']);
});

test('renderIssue then parseIssue round-trips, even with --> in a reason', () => {
  const marks: Marks = {
    'libraries/js/x.yml#1': { since: '2026-11-01', check: 'links', reason: 'docs link does not resolve: https://x.example/a-->b' },
    'applications/y.yml#0': { since: '2026-11-20', check: 'abandoned', reason: 'repository a/b is archived' },
  };
  const body = renderIssue(marks, '2026-11-27');
  assert.deepEqual(parseIssue(body), marks);
  assert.match(body, /libraries\/js\/x\.yml/);
  assert.match(body, /2026-12-01/); // removal date: 30 days after 2026-11-01
});

test('parseIssue of a body without marks is empty', () => {
  assert.deepEqual(parseIssue('Nothing here yet.'), {});
  assert.deepEqual(parseIssue(''), {});
});

test('renderIssue with no marks says so', () => {
  assert.match(renderIssue({}, '2026-11-27'), /No entries are marked/);
});

const TWO = 'name: X\noptions:\n  - tier: native\n    repo: https://github.com/x/x\n  - tier: third-party\n    repo: https://github.com/acme/x-otel\n    note: A note.\n';

test('removeOptions drops one of two options and keeps the rest of the file', () => {
  const out = removeOptions(TWO, [1])!;
  assert.match(out, /name: X/);
  assert.match(out, /github\.com\/x\/x/);
  assert.doesNotMatch(out, /acme/);
});

test('removeOptions returns null when the last option goes', () => {
  assert.equal(removeOptions(TWO, [0, 1]), null);
});
