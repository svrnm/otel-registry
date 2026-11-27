import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, loadTargets, targetKey, TIERS } from '../src/registry/targets.ts';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const file = (target: string, options: string, extra = '') => `target: ${target}\n${extra}options:\n${options}`;
const NEST = file('https://github.com/nestjs/nest', '  - tier: third-party\n    repo: https://github.com/pragmaticivan/nestjs-otel\n');
const K8S = file('https://github.com/kubernetes/kubernetes', '  - tier: native\n    docs: https://kubernetes.io/docs/concepts/cluster-administration/system-traces/\n');

test('tiers are in priority order', () => {
  assert.deepEqual([...TIERS], ['native', 'first-party', 'otel', 'third-party']);
});

test('parses a library file: language from the path, target from the file', () => {
  const t = parseTarget('libraries/js/nestjs.yml', NEST);
  assert.deepEqual([t.file, t.kind, t.language, t.target, t.name], ['libraries/js/nestjs.yml', 'library', 'js', 'https://github.com/nestjs/nest', undefined]);
  assert.deepEqual(t.options, [{ tier: 'third-party', repo: 'https://github.com/pragmaticivan/nestjs-otel' }]);
});

test('application has no language', () => {
  const t = parseTarget('applications/kubernetes.yml', K8S);
  assert.deepEqual([t.kind, t.language], ['application', undefined]);
});

test('a native option needs neither repo nor docs when the target is a GitHub repo', () => {
  const t = parseTarget('applications/x.yml', file('https://github.com/x/x', '  - tier: native\n'));
  assert.deepEqual(t.options, [{ tier: 'native' }]);
});

test('rejects a file without target', () => {
  assert.throws(() => parseTarget('applications/x.yml', 'options:\n  - tier: native\n'), /applications\/x\.yml.*target/s);
});

test('requires a name when the target is not a GitHub repository', () => {
  const GO = (extra: string) => file('https://pkg.go.dev/net/http', '  - tier: third-party\n    repo: https://github.com/acme/otelhttp\n', extra);
  assert.throws(() => parseTarget('libraries/go/net-http.yml', GO('')), /name/);
  assert.equal(parseTarget('libraries/go/net-http.yml', GO('name: net/http\n')).name, 'net/http');
  const SUB = file('https://github.com/rails/rails/tree/main/actionpack', '  - tier: third-party\n    repo: https://github.com/acme/x\n');
  assert.throws(() => parseTarget('libraries/ruby/actionpack.yml', SUB), /name/);
});

test('rejects unknown fields, including the old note', () => {
  assert.throws(() => parseTarget('applications/x.yml', file('https://github.com/x/x', '  - tier: native\n    note: hello\n')), /applications\/x\.yml/);
  assert.throws(() => parseTarget('applications/x.yml', file('https://github.com/x/x', '  - tier: native\n', 'website: https://x.example\n')), /applications\/x\.yml/);
});

test('an option that is not native needs repo or docs', () => {
  assert.throws(() => parseTarget('applications/x.yml', file('https://github.com/x/x', '  - tier: first-party\n')), /repo or docs/);
});

test('a library option that is not native needs a public repo', () => {
  assert.throws(
    () => parseTarget('libraries/js/x.yml', file('https://github.com/x/x', '  - tier: first-party\n    docs: https://x.example\n    license: proprietary\n')),
    /public repo/,
  );
});

test('closed source: only with license: proprietary, and only for applications', () => {
  const closed = (lic: string) => file('https://vendor.example/product', `  - tier: native\n    docs: https://vendor.example/otel\n${lic}`, 'name: Product\n');
  assert.throws(() => parseTarget('applications/product.yml', closed('')), /proprietary/);
  assert.equal(parseTarget('applications/product.yml', closed('    license: proprietary\n')).options[0].license, 'proprietary');
  assert.throws(() => parseTarget('libraries/js/product.yml', closed('    license: proprietary\n')), /public repo/);
});

test('rejects bad tier, empty options, and tier otel outside the open-telemetry org', () => {
  assert.throws(() => parseTarget('libraries/js/x.yml', file('https://github.com/x/x', '  - tier: gold\n    repo: https://github.com/a/b\n')), /tier/);
  assert.throws(() => parseTarget('libraries/js/x.yml', 'target: https://github.com/x/x\noptions: []\n'), /libraries\/js\/x\.yml/);
  assert.throws(() => parseTarget('libraries/js/x.yml', file('https://github.com/x/x', '  - tier: otel\n    repo: https://github.com/acme/x\n')), /open-telemetry/);
});

test('rejects path with space or upper case, and paths outside libraries/<lang>/ or applications/', () => {
  assert.throws(() => parseTarget('applications/Kong Mesh.yml', K8S), /Kong Mesh/);
  assert.throws(() => parseTarget('tools/x.yml', K8S), /tools\/x\.yml/);
  assert.throws(() => parseTarget('libraries/x.yml', NEST), /libraries\/x\.yml/);
});

test('targetKey: same target and language is the same key, whatever the spelling', () => {
  const a = targetKey({ language: 'js', target: 'https://github.com/NestJS/nest/' });
  assert.equal(a, targetKey({ language: 'js', target: 'https://github.com/nestjs/nest' }));
  assert.notEqual(a, targetKey({ language: 'python', target: 'https://github.com/nestjs/nest' }));
  assert.notEqual(a, targetKey({ target: 'https://github.com/nestjs/nest' }));
});

test('loadTargets reads every entry file, sorted, and skips explorer.yml', () => {
  const files = loadTargets(fixtures + 'data').map((t) => t.file);
  assert.deepEqual(files, ['applications/traefik-proxy.yml', 'libraries/dotnet/aspnetcore.yml']);
});

test('loadTargets reports all bad files at once', () => {
  assert.throws(
    () => loadTargets(fixtures + 'bad-data'),
    (e: Error) => e.message.includes('libraries/js/bad-tier.yml') && e.message.includes('applications/unknown-field.yml'),
  );
});
