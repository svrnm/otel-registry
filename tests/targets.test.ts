import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTarget, loadTargets, TIERS } from '../src/registry/targets.ts';

const fixtures = new URL('./fixtures/', import.meta.url).pathname;
const LIB = 'name: ASP.NET Core\noptions:\n  - tier: native\n    repo: https://github.com/dotnet/aspnetcore\n';
const APP = 'name: Traefik Proxy\noptions:\n  - tier: native\n    repo: https://github.com/traefik/traefik\n';

test('tiers are in priority order', () => {
  assert.deepEqual([...TIERS], ['native', 'first-party', 'otel', 'third-party']);
});

test('parses a library file', () => {
  const t = parseTarget('libraries/dotnet/aspnetcore.yml', LIB);
  assert.deepEqual([t.id, t.kind, t.language, t.name], ['libraries/dotnet/aspnetcore', 'library', 'dotnet', 'ASP.NET Core']);
  assert.equal(t.file, 'libraries/dotnet/aspnetcore.yml');
  assert.deepEqual(t.options, [{ tier: 'native', repo: 'https://github.com/dotnet/aspnetcore' }]);
});

test('application has no language', () => {
  const t = parseTarget('applications/traefik-proxy.yml', APP);
  assert.equal(t.kind, 'application');
  assert.equal(t.language, undefined);
});

test('rejects unknown field', () => {
  assert.throws(
    () => parseTarget('applications/x.yml', 'name: X\nwebsite: https://x\noptions:\n  - tier: native\n    docs: https://x\n    license: proprietary\n'),
    /applications\/x\.yml/,
  );
});

test('rejects option without repo or docs', () => {
  assert.throws(() => parseTarget('applications/x.yml', 'name: X\noptions:\n  - tier: native\n'), /repo or docs/);
});

test('rejects library option without repo', () => {
  assert.throws(
    () => parseTarget('libraries/js/x.yml', 'name: X\noptions:\n  - tier: native\n    docs: https://x\n    license: proprietary\n'),
    /public repo/,
  );
});

test('rejects docs-only application option without license: proprietary', () => {
  assert.throws(() => parseTarget('applications/x.yml', 'name: X\noptions:\n  - tier: native\n    docs: https://x\n'), /proprietary/);
});

test('accepts docs-only application option with license: proprietary', () => {
  const t = parseTarget('applications/x.yml', 'name: X\noptions:\n  - tier: native\n    docs: https://x\n    license: proprietary\n');
  assert.equal(t.options[0].license, 'proprietary');
});

test('rejects bad tier', () => {
  assert.throws(() => parseTarget('libraries/js/x.yml', 'name: X\noptions:\n  - tier: gold\n    repo: https://github.com/a/b\n'), /tier/);
});

test('rejects a file with no options', () => {
  assert.throws(() => parseTarget('libraries/js/x.yml', 'name: X\noptions: []\n'), /libraries\/js\/x\.yml/);
});

test('rejects path with space or upper case', () => {
  assert.throws(() => parseTarget('applications/Kong Mesh.yml', APP), /Kong Mesh/);
});

test('rejects path outside libraries/<lang>/ or applications/', () => {
  assert.throws(() => parseTarget('tools/x.yml', APP), /tools\/x\.yml/);
  assert.throws(() => parseTarget('libraries/x.yml', LIB), /libraries\/x\.yml/);
});

test('loadTargets reads every file, sorted by id', () => {
  const ids = loadTargets(fixtures + 'data').map((t) => t.id);
  assert.deepEqual(ids, ['applications/traefik-proxy', 'libraries/dotnet/aspnetcore']);
});

test('loadTargets reports all bad files at once', () => {
  assert.throws(
    () => loadTargets(fixtures + 'bad-data'),
    (e: Error) => e.message.includes('libraries/js/bad-tier.yml') && e.message.includes('applications/unknown-field.yml'),
  );
});
