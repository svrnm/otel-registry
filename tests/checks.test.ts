import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks, linksToCheck, runChecks } from '../src/registry/checks.ts';
import type { LinkStatus } from '../src/registry/checks.ts';
import type { HandTarget, HandOption } from '../src/registry/targets.ts';
import type { GeneratedTarget } from '../src/registry/explorer.ts';
import type { Facts, RepoFacts } from '../src/registry/facts.ts';

const lib = (id: string, ...options: HandOption[]): HandTarget => ({
  id: `libraries/js/${id}`, file: `libraries/js/${id}.yml`, kind: 'library', language: 'js', name: id, options,
});
const ok = (over: Partial<RepoFacts> = {}): RepoFacts => ({ exists: true, archived: false, license: 'MIT', owner: 'acme', ...over });
const facts = (entries: Record<string, RepoFacts | 'unknown'>): Facts => new Map(Object.entries(entries));
const noLinks = new Map<string, LinkStatus>();
const opt = (over: Partial<HandOption> = {}): HandOption => ({ tier: 'third-party', repo: 'https://github.com/acme/x', ...over });

test('healthy option has no finding', () => {
  assert.deepEqual(runChecks([lib('x', opt())], [], facts({ 'acme/x': ok() }), noLinks), []);
});

test('repo that no longer exists is marked', () => {
  const f = runChecks([lib('x', opt())], [], facts({ 'acme/x': { exists: false, archived: false, owner: 'acme' } }), noLinks);
  assert.deepEqual(f.map((x) => [x.file, x.option, x.check]), [['libraries/js/x.yml', 0, 'repo']]);
});

test('archived repo is marked abandoned', () => {
  assert.equal(runChecks([lib('x', opt())], [], facts({ 'acme/x': ok({ archived: true }) }), noLinks)[0].check, 'abandoned');
});

test('no detected and no declared licence is marked', () => {
  assert.equal(runChecks([lib('x', opt())], [], facts({ 'acme/x': ok({ license: undefined }) }), noLinks)[0].check, 'licence');
});

test('declared license satisfies the licence check', () => {
  assert.deepEqual(runChecks([lib('x', opt({ license: 'Artistic-1.0-Perl' }))], [], facts({ 'acme/x': ok({ license: undefined }) }), noLinks), []);
});

test('dead docs link is marked', () => {
  const links = new Map<string, LinkStatus>([['https://docs.example/x', 'dead']]);
  assert.equal(runChecks([lib('x', opt({ docs: 'https://docs.example/x' }))], [], facts({ 'acme/x': ok() }), links)[0].check, 'links');
});

test('dead subdirectory repo link is marked', () => {
  const repo = 'https://github.com/acme/mono/tree/main/packages/x';
  const f = runChecks([lib('x', opt({ repo }))], [], facts({ 'acme/mono': ok() }), new Map<string, LinkStatus>([[repo, 'dead']]));
  assert.equal(f[0].check, 'links');
});

test('dead non-GitHub repo link is marked as repo', () => {
  const repo = 'https://gitlab.com/acme/x';
  assert.equal(runChecks([lib('x', opt({ repo, license: 'MIT' }))], [], facts({}), new Map<string, LinkStatus>([[repo, 'dead']]))[0].check, 'repo');
});

test('unknown facts produce no finding', () => {
  assert.deepEqual(runChecks([lib('x', opt())], [], facts({ 'acme/x': 'unknown' }), noLinks), []);
  assert.deepEqual(runChecks([lib('x', opt())], [], facts({}), noLinks), []);
});

test('unknown link status produces no finding', () => {
  const links = new Map<string, LinkStatus>([['https://docs.example/x', 'unknown']]);
  assert.deepEqual(runChecks([lib('x', opt({ docs: 'https://docs.example/x' }))], [], facts({ 'acme/x': ok() }), links), []);
});

test('second option with the same repo or package is a duplicate', () => {
  const sameRepo = runChecks([lib('x', opt(), opt({ repo: 'https://github.com/Acme/x/' }))], [], facts({ 'acme/x': ok() }), noLinks);
  assert.deepEqual(sameRepo.map((x) => [x.option, x.check]), [[1, 'duplicate']]);
  const samePkg = runChecks(
    [lib('x', opt({ package: 'npm:x-otel' }), opt({ repo: 'https://github.com/other/y', package: 'npm:x-otel' }))],
    [], facts({ 'acme/x': ok(), 'other/y': ok() }), noLinks,
  );
  assert.deepEqual(samePkg.map((x) => [x.option, x.check]), [[1, 'duplicate']]);
});

test('hand-written otel option duplicating the generated one is marked', () => {
  const generated: GeneratedTarget[] = [{
    id: 'libraries/js/express', language: 'js', name: 'express',
    option: { tier: 'otel', repo: 'https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-express', package: 'npm:@opentelemetry/instrumentation-express' },
  }];
  const hand = lib(
    'express',
    opt({ tier: 'first-party', repo: 'https://github.com/expressjs/otel' }),
    opt({ tier: 'otel', repo: 'https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/plugins/node/opentelemetry-instrumentation-express' }),
  );
  const f = runChecks([hand], generated, facts({ 'expressjs/otel': ok(), 'open-telemetry/opentelemetry-js-contrib': ok() }), noLinks);
  assert.deepEqual(f.map((x) => [x.option, x.check]), [[1, 'duplicate']]);
});

test('a third-party option on a target the Explorer covers is not a duplicate', () => {
  const generated: GeneratedTarget[] = [{ id: 'libraries/js/x', language: 'js', name: 'x', option: { tier: 'otel', repo: 'https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-x' } }];
  assert.deepEqual(runChecks([lib('x', opt())], generated, facts({ 'acme/x': ok() }), noLinks), []);
});

test('at most one finding per option, duplicate first', () => {
  const f = runChecks([lib('x', opt(), opt())], [], facts({ 'acme/x': ok({ archived: true }) }), noLinks);
  assert.deepEqual(f.map((x) => [x.option, x.check]), [[0, 'abandoned'], [1, 'duplicate']]);
});

test('linksToCheck lists docs, subdirectory repos and non-GitHub repos, once each', () => {
  const urls = linksToCheck([
    lib('x', opt({ docs: 'https://d.example/a' }), opt({ repo: 'https://github.com/a/b/tree/main/p', docs: 'https://d.example/a' })),
    lib('y', opt({ repo: 'https://gitlab.com/a/b' })),
  ]);
  assert.deepEqual(urls.sort(), ['https://d.example/a', 'https://github.com/a/b/tree/main/p', 'https://gitlab.com/a/b']);
});

test('403, 429, 500 and a network error are unknown, 404 and 410 are dead, 200 is ok', async () => {
  const statuses: Record<string, number> = { 'https://a/200': 200, 'https://a/403': 403, 'https://a/404': 404, 'https://a/410': 410, 'https://a/429': 429, 'https://a/500': 500 };
  const fake = async (url: string | URL | Request) => {
    if (String(url) === 'https://a/throws') throw new Error('ECONNRESET');
    return new Response('', { status: statuses[String(url)] });
  };
  const r = await checkLinks([...Object.keys(statuses), 'https://a/throws'], fake as typeof fetch);
  assert.deepEqual(Object.fromEntries(r), {
    'https://a/200': 'ok', 'https://a/403': 'unknown', 'https://a/404': 'dead', 'https://a/410': 'dead',
    'https://a/429': 'unknown', 'https://a/500': 'unknown', 'https://a/throws': 'unknown',
  });
});

test('unknownOptions lists options whose facts or link status gave no definite answer', async () => {
  const { unknownOptions } = await import('../src/registry/checks.ts');
  const targets = [
    lib('a', opt()),                                                            // facts known
    lib('b', opt({ repo: 'https://github.com/acme/b' })),                       // facts unknown
    lib('c', opt({ repo: 'https://github.com/acme/c', docs: 'https://d.example/c' })), // link unknown
    lib('d', opt({ repo: 'https://github.com/acme/d', docs: 'https://d.example/d' })), // all known
    lib('e', opt({ repo: 'https://github.com/acme/mono/tree/main/e' })),        // subdirectory link never answered
  ];
  const f = facts({ 'acme/x': ok(), 'acme/b': 'unknown', 'acme/c': ok(), 'acme/d': ok(), 'acme/mono': ok() });
  const links = new Map<string, LinkStatus>([['https://d.example/c', 'unknown'], ['https://d.example/d', 'ok']]);
  assert.deepEqual(unknownOptions(targets, f, links), ['libraries/js/b.yml#0', 'libraries/js/c.yml#0', 'libraries/js/e.yml#0']);
});
