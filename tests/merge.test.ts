import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/registry/merge.ts';
import type { HandTarget, HandOption } from '../src/registry/targets.ts';
import type { GeneratedTarget } from '../src/registry/explorer.ts';
import type { CncfLevel, Facts, RepoFacts } from '../src/registry/facts.ts';
import type { Finding } from '../src/registry/checks.ts';

const NEST = 'https://github.com/nestjs/nest';
const lib = (file: string, target: string, ...options: HandOption[]): HandTarget => ({ file: `libraries/js/${file}.yml`, kind: 'library', language: 'js', target, options });
const fact = (over: Partial<RepoFacts> = {}): RepoFacts => ({ exists: true, archived: false, license: 'MIT', owner: 'Acme', ...over });
const noFacts: Facts = new Map();
const noCncf = new Map<string, CncfLevel>();
const marked = (file: string, option: number): Finding => ({ file, option, check: 'abandoned', reason: 'archived' });
const gen = (target: string, known = true): GeneratedTarget => ({
  ref: 'javascript/instrumentation-nestjs-core', language: 'js', name: 'nestjs-core', target, known,
  option: { tier: 'otel', repo: 'https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-nestjs-core', package: 'npm:@opentelemetry/instrumentation-nestjs-core' },
});
const third = (repo: string): HandOption => ({ tier: 'third-party', repo });

test('an entry carries only the target, its language and its options', () => {
  const [e] = buildRegistry([lib('nestjs', NEST, third('https://github.com/pragmaticivan/nestjs-otel'))], [], noFacts, noCncf, []);
  assert.deepEqual(e, { target: NEST, language: 'js', options: [{ tier: 'third-party', repo: 'https://github.com/pragmaticivan/nestjs-otel' }] });
});

test('files and Explorer items with one target become one entry, best tier first', () => {
  const a = lib('nest', NEST, third('https://github.com/MetinSeylan/Nestjs-OpenTelemetry'));
  const b = lib('nestjs', 'https://github.com/NestJS/nest/', third('https://github.com/pragmaticivan/nestjs-otel'));
  const r = buildRegistry([a, b], [gen(NEST)], noFacts, noCncf, []);
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].options.map((o) => o.tier), ['otel', 'third-party', 'third-party']);
  assert.deepEqual(r[0].options.map((o) => o.repo?.split('/')[3]), ['open-telemetry', 'MetinSeylan', 'pragmaticivan']);
});

test('the same target in another language is another entry', () => {
  const py: HandTarget = { ...lib('grpc', 'https://github.com/grpc/grpc', third('https://github.com/acme/py')), file: 'libraries/python/grpc.yml', language: 'python' };
  const js = lib('grpc', 'https://github.com/grpc/grpc', third('https://github.com/acme/js'));
  assert.equal(buildRegistry([py, js], [], noFacts, noCncf, []).length, 2);
});

test('an application has category application and no language', () => {
  const app: HandTarget = { file: 'applications/k8s.yml', kind: 'application', target: 'https://github.com/kubernetes/kubernetes', options: [{ tier: 'native', docs: 'https://kubernetes.io/docs/x' }] };
  const [e] = buildRegistry([app], [], new Map([['kubernetes/kubernetes', fact({ license: 'Apache-2.0' })]]), new Map([['kubernetes/kubernetes', 'graduated' as CncfLevel]]), []);
  assert.deepEqual(e, {
    target: 'https://github.com/kubernetes/kubernetes', category: 'application', cncf: 'graduated',
    options: [{ tier: 'native', docs: 'https://kubernetes.io/docs/x', license: 'Apache-2.0' }],
  });
});

test('marked option is hidden, good sibling stays; a target with nothing left is absent', () => {
  const t = lib('x', 'https://github.com/x/x', { tier: 'native' }, third('https://github.com/acme/x-otel'));
  assert.deepEqual(buildRegistry([t], [], noFacts, noCncf, [marked(t.file, 1)])[0].options, [{ tier: 'native' }]);
  assert.deepEqual(buildRegistry([t], [], noFacts, noCncf, [marked(t.file, 0), marked(t.file, 1)]), []);
});

test('a name is kept when written, and taken from the Explorer only when the target is not a repository', () => {
  const named = { ...lib('http', 'https://pkg.go.dev/net/http', third('https://github.com/acme/x')), name: 'net/http' };
  assert.equal(buildRegistry([named], [], noFacts, noCncf, [])[0].name, 'net/http');
  assert.equal(buildRegistry([], [gen(NEST)], noFacts, noCncf, [])[0].name, undefined);
  assert.equal(buildRegistry([], [gen('https://docs.nestjs.com/')], noFacts, noCncf, [])[0].name, 'nestjs-core');
  const unknown = gen('https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-nestjs-core', false);
  assert.equal(buildRegistry([], [unknown], noFacts, noCncf, [])[0].name, 'nestjs-core');
});

test('licence is the declared one, else the detected one of the option repo or, for native, of the target', () => {
  const t = lib('x', 'https://github.com/x/x', { tier: 'native' }, third('https://github.com/acme/a'), { ...third('https://github.com/acme/b'), license: 'BSD-3-Clause' });
  const facts: Facts = new Map([['x/x', fact({ license: 'Apache-2.0' })], ['acme/a', fact()], ['acme/b', fact()]]);
  assert.deepEqual(buildRegistry([t], [], facts, noCncf, [])[0].options.map((o) => o.license), ['Apache-2.0', 'MIT', 'BSD-3-Clause']);
});

test('same tier sorts alphabetically by label; entries sort by heading', () => {
  const t = lib('x', 'https://github.com/x/x', { ...third('https://github.com/z/z'), package: 'npm:zeta' }, { ...third('https://github.com/a/a'), package: 'npm:Alpha' });
  assert.deepEqual(buildRegistry([t], [], noFacts, noCncf, [])[0].options.map((o) => o.package), ['npm:Alpha', 'npm:zeta']);
  const r = buildRegistry([lib('b', 'https://github.com/b/b', { tier: 'native' }), { ...lib('a', 'https://example.com/a', third('https://github.com/q/q')), name: 'Alpha' }], [], noFacts, noCncf, []);
  assert.deepEqual(r.map((e) => e.name ?? e.target), ['Alpha', 'https://github.com/b/b']);
});

test('cncf level comes from the target repo, falls back to its org, and is not shown for open-telemetry', () => {
  const cncf = new Map<string, CncfLevel>([['dapr/dapr', 'graduated'], ['grpc', 'incubating'], ['open-telemetry', 'graduated']]);
  const r = buildRegistry([
    lib('a', 'https://github.com/dapr/dapr', { tier: 'native' }),
    lib('b', 'https://github.com/grpc/grpc-node', { tier: 'native' }),
    lib('c', 'https://github.com/acme/c', { tier: 'native' }),
  ], [gen('https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/x', false)], noFacts, cncf, []);
  assert.deepEqual(r.map((e) => e.cncf), [undefined, 'graduated', 'incubating', undefined]);
});
