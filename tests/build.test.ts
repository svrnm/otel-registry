import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const fx = (p: string) => join(root, 'tests/fixtures', p);

function build(data: string, extra: string[] = []) {
  const out = mkdtempSync(join(tmpdir(), 'registry-'));
  const { GITHUB_TOKEN: _drop, ...env } = process.env;
  const r = spawnSync(
    process.execPath,
    [join(root, 'src/registry/build.ts'), '--data', fx(data), '--explorer', fx('explorer/ecosystem-registry'), '--out', join(out, 'registry.json'), '--report', join(out, 'report.json'), ...extra],
    { env: { ...env, REGISTRY_OFFLINE: '1' }, encoding: 'utf8' },
  );
  const read = (f: string) => JSON.parse(readFileSync(join(out, f), 'utf8'));
  return { status: r.status, output: r.stdout + r.stderr, read };
}

test('build without token exits 0, keeps all options, reports no findings', () => {
  const b = build('data');
  assert.equal(b.status, 0, b.output);
  const registry = b.read('registry.json');
  assert.equal(registry.length, 10); // 9 generated targets, one shared with a file, plus one application
  const aspnet = registry.find((e: any) => e.target === 'https://github.com/dotnet/aspnetcore');
  assert.deepEqual(aspnet.options.map((o: any) => o.tier), ['native', 'otel']);
  assert.deepEqual(Object.keys(aspnet).sort(), ['language', 'options', 'target']);
  const report = b.read('report.json');
  assert.equal(report.tokenUsed, false);
  assert.deepEqual(report.findings, []);
  // Items the Explorer does not say a target for, and data/explorer.yml does not map.
  assert.equal(report.unmapped.includes('javascript/instrumentation-winston'), true);
  assert.equal(report.unmapped.includes('dotnet/OpenTelemetry.Instrumentation.AspNetCore'), false);
});

test('build reports a duplicate but exits 0 when no --changed file is affected', () => {
  const b = build('dup-data', ['--changed', 'libraries/js/y.yml']);
  assert.equal(b.status, 0, b.output);
  assert.deepEqual(b.read('report.json').findings.map((f: any) => [f.file, f.option, f.check]), [['libraries/js/x.yml', 1, 'duplicate']]);
});

test('build exits 2 when a --changed file has a finding', () => {
  const b = build('dup-data', ['--changed', 'data/libraries/js/x.yml']);
  assert.equal(b.status, 2, b.output);
  assert.match(b.output, /libraries\/js\/x\.yml/);
});

test('build exits 1 on a schema error and names the file', () => {
  const b = build('bad-data');
  assert.equal(b.status, 1, b.output);
  assert.match(b.output, /libraries\/js\/bad-tier\.yml/);
});

test('the report lists options that could not be checked', () => {
  const b = build('data');
  // No token: every GitHub-backed option is unknown.
  assert.deepEqual(b.read('report.json').unknown, ['applications/traefik-proxy.yml#0', 'libraries/dotnet/aspnetcore.yml#0']);
});

test('a finding the tracking issue already lists does not fail the check; a new one still does', () => {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-'));
  const known = { 'libraries/js/x.yml#1': { since: '2026-11-01', check: 'duplicate', reason: 'same repo or package as an earlier option of this target' } };
  writeFileSync(join(dir, 'known.md'), `<!-- marks\n${JSON.stringify(known)}\n-->`);
  writeFileSync(join(dir, 'other.md'), `<!-- marks\n${JSON.stringify({ 'libraries/js/y.yml#0': known['libraries/js/x.yml#1'] })}\n-->`);
  const changed = ['--changed', 'libraries/js/x.yml'];
  assert.equal(build('dup-data', ['--baseline', join(dir, 'known.md'), ...changed]).status, 0);
  assert.equal(build('dup-data', ['--baseline', join(dir, 'other.md'), ...changed]).status, 2);
  assert.equal(build('dup-data', ['--baseline', join(dir, 'missing.md'), ...changed]).status, 2);
});
