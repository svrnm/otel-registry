import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/registry/merge.ts';
import type { HandTarget, HandOption } from '../src/registry/targets.ts';
import type { GeneratedTarget } from '../src/registry/explorer.ts';
import type { CncfLevel, Facts, RepoFacts } from '../src/registry/facts.ts';
import type { Finding } from '../src/registry/checks.ts';

const lib = (id: string, name: string, ...options: HandOption[]): HandTarget => ({
  id: `libraries/js/${id}`, file: `libraries/js/${id}.yml`, kind: 'library', language: 'js', name, options,
});
const fact = (over: Partial<RepoFacts> = {}): RepoFacts => ({ exists: true, archived: false, license: 'MIT', owner: 'Acme', description: 'Repo description.', ...over });
const noFacts: Facts = new Map();
const noCncf = new Map<string, CncfLevel>();
const marked = (file: string, option: number): Finding => ({ file, option, check: 'abandoned', reason: 'archived' });
const gen = (id: string, name: string, pkg: string): GeneratedTarget => ({
  id: `libraries/js/${id}`, language: 'js', name,
  option: { tier: 'otel', repo: `https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-${id}`, package: pkg, note: 'From the Explorer.' },
});

test('marked option is hidden, good sibling stays', () => {
  const t = lib('x', 'X', { tier: 'native', repo: 'https://github.com/x/x' }, { tier: 'third-party', repo: 'https://github.com/acme/x-otel' });
  const [e] = buildRegistry([t], [], noFacts, noCncf, [marked('libraries/js/x.yml', 1)]);
  assert.deepEqual(e.options.map((o) => o.repo), ['https://github.com/x/x']);
});

test('target with only a marked option is absent', () => {
  const t = lib('x', 'X', { tier: 'third-party', repo: 'https://github.com/acme/x-otel' });
  assert.deepEqual(buildRegistry([t], [], noFacts, noCncf, [marked('libraries/js/x.yml', 0)]), []);
});

test('generated and hand-written targets with one id merge, native first, hand-written name wins', () => {
  const t = lib('express', 'Express', { tier: 'native', repo: 'https://github.com/expressjs/express' });
  const [e] = buildRegistry([t], [gen('express', 'express', 'npm:@opentelemetry/instrumentation-express')], noFacts, noCncf, []);
  assert.equal(e.name, 'Express');
  assert.deepEqual(e.options.map((o) => [o.tier, o.source]), [['native', 'file'], ['otel', 'explorer']]);
});

test('a generated target without a file is a library entry', () => {
  const [e] = buildRegistry([], [gen('winston', 'winston', 'npm:@opentelemetry/instrumentation-winston')], noFacts, noCncf, []);
  assert.deepEqual([e.id, e.kind, e.language, e.name], ['libraries/js/winston', 'library', 'js', 'winston']);
  assert.equal(e.options[0].description, 'From the Explorer.');
});

test('options sort by tier, then alphabetically by package', () => {
  const t = lib('x', 'X',
    { tier: 'third-party', repo: 'https://github.com/z/z', package: 'npm:zeta' },
    { tier: 'third-party', repo: 'https://github.com/a/a', package: 'npm:Alpha' },
    { tier: 'first-party', repo: 'https://github.com/x/otel' });
  const [e] = buildRegistry([t], [], noFacts, noCncf, []);
  assert.deepEqual(e.options.map((o) => o.label), ['x/otel', 'Alpha', 'zeta']);
});

test('entries sort by name, ignoring case', () => {
  const r = buildRegistry([lib('b', 'beta', { tier: 'native', repo: 'https://github.com/b/b' }), lib('a', 'Alpha', { tier: 'native', repo: 'https://github.com/a/a' })], [], noFacts, noCncf, []);
  assert.deepEqual(r.map((e) => e.name), ['Alpha', 'beta']);
});

test('label falls back from package to repo to docs host', () => {
  const app: HandTarget = { id: 'applications/x', file: 'applications/x.yml', kind: 'application', name: 'X', options: [
    { tier: 'native', docs: 'https://docs.vendor.example/otel', license: 'proprietary' },
  ] };
  const t = lib('y', 'Y', { tier: 'third-party', repo: 'https://github.com/Acme/mono/tree/main/packages/y-otel' });
  const r = buildRegistry([app, t], [], noFacts, noCncf, []);
  assert.equal(r[0].options[0].label, 'docs.vendor.example');
  assert.equal(r[1].options[0].label, 'Acme/mono/y-otel');
});

test('inferred licence, maintainer and description come from the repo facts', () => {
  const t = lib('x', 'X', { tier: 'third-party', repo: 'https://github.com/acme/x' });
  const [e] = buildRegistry([t], [], new Map([['acme/x', fact()]]), noCncf, []);
  assert.deepEqual([e.options[0].license, e.options[0].maintainer, e.options[0].description], ['MIT', 'Acme', 'Repo description.']);
});

test('declared license and note win over inferred ones', () => {
  const t = lib('x', 'X', { tier: 'third-party', repo: 'https://github.com/acme/x', license: 'BSD-3-Clause', note: 'A note.' });
  const [e] = buildRegistry([t], [], new Map([['acme/x', fact()]]), noCncf, []);
  assert.deepEqual([e.options[0].license, e.options[0].description], ['BSD-3-Clause', 'A note.']);
});

test('subdirectory repo does not take the repo description', () => {
  const t = lib('x', 'X', { tier: 'third-party', repo: 'https://github.com/acme/mono/tree/main/packages/x' });
  const [e] = buildRegistry([t], [], new Map([['acme/mono', fact()]]), noCncf, []);
  assert.equal(e.options[0].description, undefined);
});

test('without facts the maintainer is read from the repo link and nothing else is inferred', () => {
  const t = lib('x', 'X', { tier: 'third-party', repo: 'https://github.com/Acme/x' });
  const [e] = buildRegistry([t], [], new Map([['acme/x', 'unknown' as const]]), noCncf, []);
  assert.deepEqual([e.options[0].maintainer, e.options[0].license, e.options[0].description], ['Acme', undefined, undefined]);
});

test('cncf level comes from the repo, falls back to the org, and is not shown for otel options', () => {
  const cncf = new Map<string, CncfLevel>([['dapr/dapr', 'graduated'], ['grpc', 'incubating'], ['open-telemetry', 'graduated']]);
  const t = lib('x', 'X',
    { tier: 'native', repo: 'https://github.com/dapr/dapr' },
    { tier: 'first-party', repo: 'https://github.com/grpc/grpc-node' },
    { tier: 'otel', repo: 'https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/x' },
    { tier: 'third-party', repo: 'https://github.com/acme/x' });
  const [e] = buildRegistry([t], [], noFacts, cncf, []);
  assert.deepEqual(e.options.map((o) => o.cncf), ['graduated', 'incubating', undefined, undefined]);
});
