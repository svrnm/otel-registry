// OTel-owned options, generated from the Ecosystem Explorer's registry data.
// The Explorer's layout is not a published contract: each ecosystem has its own
// small adapter, and an ecosystem that yields nothing fails the build.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';

export interface GeneratedTarget {
  id: string;
  language: string;
  name: string;
  option: { tier: 'otel'; repo: string; package?: string; note?: string };
}

const EXPLORER_REPO = 'https://github.com/open-telemetry/opentelemetry-ecosystem-explorer';
const GITHUB = 'https://github.com';

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
}

const byVersion = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const list = (dir: string) => (existsSync(dir) ? readdirSync(dir) : []);
const latest = (names: string[]) => names.filter((n) => /^v\d/.test(n)).sort(byVersion).pop();
const yaml = (file: string) => load(readFileSync(file, 'utf8')) as any;
const oneLine = (s: unknown) => (typeof s === 'string' && s.trim() ? s.trim().replace(/\s+/g, ' ') : undefined);

function commonParent(paths: string[]): string {
  const parts = paths.map((p) => p.split('/'));
  const first = parts[0];
  let n = first.length;
  for (const p of parts) {
    let i = 0;
    while (i < n && i < p.length && p[i] === first[i]) i++;
    n = i;
  }
  return first.slice(0, n).join('/');
}

function java(dir: string): GeneratedTarget[] {
  const base = join(dir, 'java', 'javaagent');
  const version = latest(list(base));
  if (!version) return [];
  const modules: any[] = yaml(join(base, version, 'instrumentation.yaml')).libraries ?? [];
  const groups = new Map<string, any[]>();
  for (const m of modules) {
    if (!m.display_name || !m.source_path) continue;
    groups.set(m.display_name, [...(groups.get(m.display_name) ?? []), m]);
  }
  return [...groups].map(([name, ms]) => ({
    id: `libraries/java/${slug(name)}`,
    language: 'java',
    name,
    option: {
      tier: 'otel' as const,
      repo: `${GITHUB}/open-telemetry/opentelemetry-java-instrumentation/tree/main/${commonParent(ms.map((m) => m.source_path))}`,
      note: oneLine(ms[0].description),
    },
  }));
}

/** JavaScript and Python share a layout: <ecosystem>/<package>/<version>.yaml */
function packages(dir: string, ecosystem: string, language: string, prefix: RegExp, pkg: (p: any) => string | undefined): GeneratedTarget[] {
  const base = join(dir, ecosystem);
  const out: GeneratedTarget[] = [];
  for (const name of list(base)) {
    const version = latest(list(join(base, name)).map((f) => f.replace(/\.ya?ml$/, '')));
    if (!version) continue;
    const p = yaml(join(base, name, `${version}.yaml`));
    if (!p?.repository || !p?.source_path) continue;
    const target = slug(name.replace(prefix, '')) || slug(name);
    out.push({
      id: `libraries/${language}/${target}`,
      language,
      name: target,
      option: { tier: 'otel', repo: `${GITHUB}/${p.repository}/tree/main/${p.source_path}`, package: pkg(p), note: oneLine(p.description) },
    });
  }
  return out;
}

function dotnet(dir: string): GeneratedTarget[] {
  const base = join(dir, 'dotnet');
  const version = latest(list(base));
  if (!version) return [];
  const PREFIX = 'OpenTelemetry.Instrumentation.';
  const modules: any[] = yaml(join(base, version, 'instrumentation.yaml')).modules ?? [];
  return modules
    .filter((m) => typeof m.name === 'string' && m.name.startsWith(PREFIX))
    .map((m) => ({
      id: `libraries/dotnet/${slug(m.name.slice(PREFIX.length))}`,
      language: 'dotnet',
      name: m.name.slice(PREFIX.length),
      option: {
        tier: 'otel' as const,
        repo: `${GITHUB}/open-telemetry/opentelemetry-dotnet-contrib/tree/main/src/${m.name}`,
        package: `nuget:${m.name}`,
        note: oneLine(m.description),
      },
    }));
}

const ADAPTERS: Record<string, (dir: string) => GeneratedTarget[]> = {
  java,
  javascript: (dir) =>
    packages(dir, 'javascript', 'js', /^instrumentation-|-instrumentation$/, (p) => (p.npm_package ? `npm:${p.npm_package}` : undefined)),
  python: (dir) => packages(dir, 'python', 'python', /^opentelemetry-instrumentation-/, (p) => (p.name ? `pypi:${p.name}` : undefined)),
  dotnet,
};

/** registryDir is <explorer checkout>/ecosystem-registry. Throws when an ecosystem yields no targets. */
export function readExplorer(registryDir: string): GeneratedTarget[] {
  const all: GeneratedTarget[] = [];
  for (const [ecosystem, adapter] of Object.entries(ADAPTERS)) {
    const targets = adapter(registryDir);
    if (targets.length === 0) {
      throw new Error(`Ecosystem Explorer: no targets found for "${ecosystem}" in ${registryDir}. Its layout may have changed.`);
    }
    all.push(...targets);
  }
  return all.sort((a, b) => a.id.localeCompare(b.id));
}

/** Shallow-clones the Explorer repo into cacheDir and returns its ecosystem-registry path. Throws on failure. */
export function fetchExplorer(cacheDir: string): string {
  rmSync(cacheDir, { recursive: true, force: true });
  execFileSync('git', ['clone', '--quiet', '--depth', '1', EXPLORER_REPO, cacheDir], { stdio: ['ignore', 'ignore', 'inherit'] });
  return join(cacheDir, 'ecosystem-registry');
}
