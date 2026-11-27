import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExplorer, readExplorerMap, resolveGenerated, slug } from '../src/registry/explorer.ts';

const FIX = new URL('./fixtures/explorer/ecosystem-registry', import.meta.url).pathname;
const DATA = new URL('./fixtures/data', import.meta.url).pathname;
const of = (language: string) => readExplorer(FIX).filter((t) => t.language === language);

test('slug', () => {
  assert.equal(slug('Spring WebMVC'), 'spring-webmvc');
  assert.equal(slug('  ASP.NET Core!'), 'asp.net-core');
});

test('java modules with one display name become one item with the library link', () => {
  const t = of('java');
  assert.deepEqual(t.map((x) => x.ref), ['java/jdbc', 'java/spring-webmvc']);
  assert.equal(t[1].name, 'Spring WebMVC');
  assert.match(t[1].link!, /^https:\/\/docs\.spring\.io\//);
  assert.match(t[1].option.repo, /opentelemetry-java-instrumentation\/tree\/main\/instrumentation\/spring\/spring-webmvc$/);
  assert.equal(readExplorer(FIX).some((x) => x.ref.includes('old-only')), false);
});

test('javascript and python items are named after the package and read the latest version', () => {
  assert.deepEqual(of('js').map((x) => x.ref), ['javascript/browser-instrumentation', 'javascript/instrumentation-express', 'javascript/instrumentation-winston']);
  const w = of('js')[2];
  assert.deepEqual([w.name, w.option.package], ['winston', 'npm:@opentelemetry/instrumentation-winston']);
  assert.equal(w.option.repo, 'https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-winston');
  assert.deepEqual(of('python').map((x) => [x.ref, x.name]), [
    ['python/opentelemetry-instrumentation-django', 'django'],
    ['python/opentelemetry-instrumentation-wsgi', 'wsgi'],
  ]);
});

test('dotnet keeps only OpenTelemetry.Instrumentation.* modules of the highest version', () => {
  const t = of('dotnet');
  assert.deepEqual(t.map((x) => x.ref), ['dotnet/OpenTelemetry.Instrumentation.AspNetCore', 'dotnet/OpenTelemetry.Instrumentation.Http']);
  assert.deepEqual([t[0].name, t[0].option.package], ['AspNetCore', 'nuget:OpenTelemetry.Instrumentation.AspNetCore']);
});

test('an ecosystem with zero items, or a missing one, throws naming the ecosystem', () => {
  for (const [ecosystem, remove] of [['python', ['python/opentelemetry-instrumentation-wsgi', 'python/opentelemetry-instrumentation-django']], ['dotnet', ['dotnet']]] as const) {
    const dir = mkdtempSync(join(tmpdir(), 'explorer-'));
    try {
      cpSync(FIX, dir, { recursive: true });
      for (const r of remove) rmSync(join(dir, r), { recursive: true });
      assert.throws(() => readExplorer(dir), new RegExp(ecosystem));
    } finally {
      rmSync(dir, { recursive: true });
    }
  }
});

test('the explorer map is read from data/explorer.yml and is empty when the file is missing', () => {
  assert.deepEqual([...readExplorerMap(DATA)], [['dotnet/OpenTelemetry.Instrumentation.AspNetCore', 'https://github.com/dotnet/aspnetcore']]);
  assert.equal(readExplorerMap(FIX).size, 0);
});

test('a malformed explorer map is an error that names the file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'map-'));
  try {
    writeFileSync(join(dir, 'explorer.yml'), 'dotnet/X: not-a-url\n');
    assert.throws(() => readExplorerMap(dir), /explorer\.yml/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('the target of an item is the mapped link, else what the Explorer says, else its own repo', () => {
  const items = readExplorer(FIX);
  const r = resolveGenerated(items, new Map([['dotnet/OpenTelemetry.Instrumentation.AspNetCore', 'https://github.com/dotnet/aspnetcore']]));
  const by = (ref: string) => r.find((x) => x.ref === ref)!;
  assert.deepEqual([by('dotnet/OpenTelemetry.Instrumentation.AspNetCore').target, by('dotnet/OpenTelemetry.Instrumentation.AspNetCore').known], ['https://github.com/dotnet/aspnetcore', true]);
  assert.match(by('java/spring-webmvc').target, /^https:\/\/docs\.spring\.io\//);
  assert.equal(by('java/spring-webmvc').known, true);
  const winston = by('javascript/instrumentation-winston');
  assert.deepEqual([winston.target, winston.known], [winston.option.repo, false]);
});
