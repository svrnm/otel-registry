// OTel-owned options, generated from the Ecosystem Explorer's registry data.
// The Explorer's layout is not a published contract: each ecosystem has its own
// small adapter, and an ecosystem that yields nothing fails the build.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { EXPLORER_MAP } from './targets.ts';

/** One OTel-owned instrumentation as the Explorer lists it. `link` is what the Explorer says it instruments. */
export interface GeneratedItem {
  ref: string; // '<ecosystem>/<explorer name>', the key used in data/explorer.yml
  language: string;
  name: string;
  link?: string;
  option: { tier: 'otel'; repo: string; package?: string };
}

/** An item with its target settled. `known` is false when nothing says what it instruments. */
export interface GeneratedTarget extends GeneratedItem {
  target: string;
  known: boolean;
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
const isUrl = (s: unknown): s is string => typeof s === 'string' && /^https?:\/\/\S+$/.test(s);

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

function java(dir: string): GeneratedItem[] {
  const base = join(dir, 'java', 'javaagent');
  const version = latest(list(base));
  if (!version) return [];
  const modules: any[] = yaml(join(base, version, 'instrumentation.yaml')).libraries ?? [];
  const groups = new Map<string, any[]>();
  for (const m of modules) {
    if (!m.display_name || !m.source_path) continue;
    groups.set(m.display_name, [...(groups.get(m.display_name) ?? []), m]);
  }
  return [...groups].map(([name, ms]) => {
    const link = ms.map((m) => m.library_link).find(isUrl);
    return {
      ref: `java/${slug(name)}`,
      language: 'java',
      name,
      ...(link ? { link } : {}),
      option: {
        tier: 'otel' as const,
        repo: `${GITHUB}/open-telemetry/opentelemetry-java-instrumentation/tree/main/${commonParent(ms.map((m) => m.source_path))}`,
      },
    };
  });
}

/** JavaScript and Python share a layout: <ecosystem>/<package>/<version>.yaml */
function packages(dir: string, ecosystem: string, language: string, prefix: RegExp, pkg: (p: any) => string | undefined): GeneratedItem[] {
  const base = join(dir, ecosystem);
  const out: GeneratedItem[] = [];
  for (const name of list(base)) {
    const version = latest(list(join(base, name)).map((f) => f.replace(/\.ya?ml$/, '')));
    if (!version) continue;
    const p = yaml(join(base, name, `${version}.yaml`));
    if (!p?.repository || !p?.source_path) continue;
    const packageName = pkg(p);
    out.push({
      ref: `${ecosystem}/${name}`,
      language,
      name: name.replace(prefix, '') || name,
      option: { tier: 'otel', repo: `${GITHUB}/${p.repository}/tree/main/${p.source_path}`, ...(packageName ? { package: packageName } : {}) },
    });
  }
  return out;
}

function dotnet(dir: string): GeneratedItem[] {
  const base = join(dir, 'dotnet');
  const version = latest(list(base));
  if (!version) return [];
  const PREFIX = 'OpenTelemetry.Instrumentation.';
  const modules: any[] = yaml(join(base, version, 'instrumentation.yaml')).modules ?? [];
  return modules
    .filter((m) => typeof m.name === 'string' && m.name.startsWith(PREFIX))
    .map((m) => ({
      ref: `dotnet/${m.name}`,
      language: 'dotnet',
      name: m.name.slice(PREFIX.length),
      option: { tier: 'otel' as const, repo: `${GITHUB}/open-telemetry/opentelemetry-dotnet-contrib/tree/main/src/${m.name}`, package: `nuget:${m.name}` },
    }));
}

const ADAPTERS: Record<string, (dir: string) => GeneratedItem[]> = {
  java,
  javascript: (dir) =>
    packages(dir, 'javascript', 'js', /^instrumentation-|-instrumentation$/, (p) => (p.npm_package ? `npm:${p.npm_package}` : undefined)),
  python: (dir) => packages(dir, 'python', 'python', /^opentelemetry-instrumentation-/, (p) => (p.name ? `pypi:${p.name}` : undefined)),
  dotnet,
};

/** registryDir is <explorer checkout>/ecosystem-registry. Throws when an ecosystem yields no items. */
export function readExplorer(registryDir: string): GeneratedItem[] {
  const all: GeneratedItem[] = [];
  for (const [ecosystem, adapter] of Object.entries(ADAPTERS)) {
    const items = adapter(registryDir);
    if (items.length === 0) {
      throw new Error(`Ecosystem Explorer: no items found for "${ecosystem}" in ${registryDir}. Its layout may have changed.`);
    }
    all.push(...items);
  }
  return all.sort((a, b) => a.ref.localeCompare(b.ref));
}

/**
 * data/explorer.yml: `<ref>: <target link>` for items where the Explorer does not say what
 * they instrument, or says it differently from the entry they belong to. Empty when missing.
 */
export function readExplorerMap(dataDir: string): Map<string, string> {
  const file = join(dataDir, EXPLORER_MAP);
  if (!existsSync(file)) return new Map();
  const raw = (load(readFileSync(file, 'utf8')) ?? {}) as Record<string, unknown>;
  const bad = Object.entries(raw).filter(([, v]) => !isUrl(v)).map(([k]) => k);
  if (bad.length) throw new Error(`${EXPLORER_MAP}: not an http(s) link for ${bad.join(', ')}`);
  return new Map(Object.entries(raw) as [string, string][]);
}

/** The target of an item: the mapped link, else what the Explorer says, else the item's own repo. */
export function resolveGenerated(items: GeneratedItem[], map: Map<string, string>): GeneratedTarget[] {
  return items.map((item) => {
    const target = map.get(item.ref) ?? item.link;
    return { ...item, target: target ?? item.option.repo, known: !!target };
  });
}

/** Shallow-clones the Explorer repo into cacheDir and returns its ecosystem-registry path. Throws on failure. */
export function fetchExplorer(cacheDir: string): string {
  rmSync(cacheDir, { recursive: true, force: true });
  execFileSync('git', ['clone', '--quiet', '--depth', '1', EXPLORER_REPO, cacheDir], { stdio: ['ignore', 'ignore', 'inherit'] });
  return join(cacheDir, 'ecosystem-registry');
}
