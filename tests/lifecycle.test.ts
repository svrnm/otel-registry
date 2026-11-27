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

test('a mark whose option could not be checked this run keeps its date', () => {
  const prev: Marks = {
    'libraries/js/x.yml#0': { since: '2026-11-01', check: 'links', reason: 'repo link does not resolve' },
    'libraries/js/y.yml#0': { since: '2026-11-02', check: 'links', reason: 'gone' },
  };
  const next = updateMarks(prev, [], '2026-11-27', ['libraries/js/x.yml#0', 'libraries/js/never-marked.yml#0']);
  assert.deepEqual(next, { 'libraries/js/x.yml#0': prev['libraries/js/x.yml#0'] });
});

test('parseIssue ignores anything that is not a well-formed mark', () => {
  const body = (json: string) => `<!-- marks\n${json}\n-->`;
  assert.deepEqual(parseIssue(body('null')), {});
  assert.deepEqual(parseIssue(body('[1,2]')), {});
  assert.deepEqual(
    parseIssue(body(JSON.stringify({
      'a.yml#0': { since: 'soon', check: 'repo', reason: 'x' },
      'b.yml#0': { since: '2026-11-01', check: 'repo', reason: 'x' },
      'c.yml#0': 'nope',
      'd.yml#0': { since: '2026-11-01', check: 'made-up', reason: 'x' },
      'e.yml': { since: '2026-11-01', check: 'repo', reason: 'x' },
    }))),
    { 'b.yml#0': { since: '2026-11-01', check: 'repo', reason: 'x' } },
  );
});

test('pickIssue takes only the tracking issue written by the Actions bot', async () => {
  const { pickIssue } = await import('../src/registry/lifecycle.ts');
  const mine = { number: 3, title: 'Marked entries', body: '', author: { login: 'app/github-actions', is_bot: true } };
  const spoof = { number: 9, title: 'Marked entries', body: '', author: { login: 'mallory', is_bot: false } };
  const other = { number: 4, title: 'Marked entries are wrong', body: '', author: { login: 'app/github-actions', is_bot: true } };
  assert.equal(pickIssue([spoof, other, mine])?.number, 3);
  assert.equal(pickIssue([spoof, other]), undefined);
});

test('pickPr ignores pull requests from forks', async () => {
  const { pickPr } = await import('../src/registry/lifecycle.ts');
  assert.equal(pickPr([{ number: 7, isCrossRepository: true }, { number: 8, isCrossRepository: false }])?.number, 8);
  assert.equal(pickPr([{ number: 7, isCrossRepository: true }]), undefined);
});

test('removal threshold comes from the environment and defaults to 30', async () => {
  const { thresholdDays } = await import('../src/registry/lifecycle.ts');
  assert.equal(thresholdDays(undefined), 30);
  assert.equal(thresholdDays(''), 30);
  assert.equal(thresholdDays('0'), 0);
  assert.equal(thresholdDays('7'), 7);
  assert.equal(thresholdDays('-1'), 30);
  assert.equal(thresholdDays('soon'), 30);
});
