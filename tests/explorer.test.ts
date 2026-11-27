import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readExplorer, slug } from '../src/registry/explorer.ts';

const FIX = new URL('./fixtures/explorer/ecosystem-registry', import.meta.url).pathname;
const of = (language: string) => readExplorer(FIX).filter((t) => t.language === language);

test('slug', () => {
  assert.equal(slug('Spring WebMVC'), 'spring-webmvc');
  assert.equal(slug('  ASP.NET Core!'), 'asp.net-core');
});

test('java modules with one display name become one target', () => {
  const t = of('java');
  assert.deepEqual(t.map((x) => x.id), ['libraries/java/jdbc', 'libraries/java/spring-webmvc']);
  assert.equal(t[1].name, 'Spring WebMVC');
  assert.equal(t[1].option.tier, 'otel');
  assert.match(t[1].option.repo, /opentelemetry-java-instrumentation\/tree\/main\/instrumentation\/spring\/spring-webmvc$/);
  assert.match(t[0].option.repo, /tree\/main\/instrumentation\/jdbc$/);
});

test('java reads only the latest release', () => {
  assert.equal(of('java').some((x) => x.id.includes('old-only')), false);
});

test('js strips the instrumentation- prefix and reads the latest version', () => {
  const t = of('js');
  assert.deepEqual(t.map((x) => x.id), ['libraries/js/browser', 'libraries/js/express', 'libraries/js/winston']);
  const w = t[2];
  assert.equal(w.name, 'winston');
  assert.equal(w.option.package, 'npm:@opentelemetry/instrumentation-winston');
  assert.equal(w.option.repo, 'https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/instrumentation-winston');
  assert.notEqual(w.option.note, 'Must not be read.');
});

test('python strips opentelemetry-instrumentation-', () => {
  const t = of('python');
  assert.deepEqual(t.map((x) => x.id), ['libraries/python/django', 'libraries/python/wsgi']);
  assert.equal(t[1].option.package, 'pypi:opentelemetry-instrumentation-wsgi');
  assert.equal(t[1].option.repo, 'https://github.com/open-telemetry/opentelemetry-python-contrib/tree/main/instrumentation/opentelemetry-instrumentation-wsgi');
  assert.notEqual(t[1].option.note, 'Must not be read.');
});

test('dotnet keeps only OpenTelemetry.Instrumentation.* modules of the highest version', () => {
  const t = of('dotnet');
  assert.deepEqual(t.map((x) => x.id), ['libraries/dotnet/aspnetcore', 'libraries/dotnet/http']);
  assert.equal(t[0].name, 'AspNetCore');
  assert.equal(t[0].option.package, 'nuget:OpenTelemetry.Instrumentation.AspNetCore');
  assert.equal(t[0].option.repo, 'https://github.com/open-telemetry/opentelemetry-dotnet-contrib/tree/main/src/OpenTelemetry.Instrumentation.AspNetCore');
});

test('an ecosystem with zero targets throws naming the ecosystem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-'));
  try {
    cpSync(FIX, dir, { recursive: true });
    rmSync(join(dir, 'python', 'opentelemetry-instrumentation-wsgi'), { recursive: true });
    rmSync(join(dir, 'python', 'opentelemetry-instrumentation-django'), { recursive: true });
    assert.throws(() => readExplorer(dir), /python/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test('a missing ecosystem directory throws naming the ecosystem', () => {
  const dir = mkdtempSync(join(tmpdir(), 'explorer-'));
  try {
    cpSync(FIX, dir, { recursive: true });
    rmSync(join(dir, 'dotnet'), { recursive: true });
    assert.throws(() => readExplorer(dir), /dotnet/);
  } finally {
    rmSync(dir, { recursive: true });
  }
});
