// Turns hand-written files, Explorer options, inferred facts and check findings
// into the list the page renders: one entry per target, best option first.
import { TIERS } from './targets.ts';
import type { HandTarget, Tier } from './targets.ts';
import type { GeneratedTarget } from './explorer.ts';
import { isSubdirectory, repoKey } from './facts.ts';
import type { CncfLevel, Facts } from './facts.ts';
import type { Finding } from './checks.ts';

export interface RegistryOption {
  tier: Tier;
  label: string;
  repo?: string;
  docs?: string;
  package?: string;
  license?: string;
  maintainer?: string;
  description?: string;
  cncf?: CncfLevel;
  source: 'file' | 'explorer';
}

export interface RegistryEntry {
  id: string;
  kind: 'library' | 'application';
  language?: string;
  name: string;
  options: RegistryOption[];
}

interface RawOption {
  tier: Tier;
  repo?: string;
  docs?: string;
  package?: string;
  license?: string;
  note?: string;
}

const compare = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });
const sortKey = (o: { package?: string; repo?: string; docs?: string }) => (o.package ? o.package.replace(/^[a-z]+:/, '') : (o.repo ?? o.docs ?? ''));

function label(o: RawOption): string {
  if (o.package) return o.package.replace(/^[a-z]+:/, '');
  if (o.repo) {
    const m = /^https?:\/\/github\.com\/([^/]+)\/([^/#?]+)/i.exec(o.repo);
    if (!m) return new URL(o.repo).host;
    const base = `${m[1]}/${m[2].replace(/\.git$/, '')}`;
    return isSubdirectory(o.repo) ? `${base}/${o.repo.replace(/\/+$/, '').split('/').pop()}` : base;
  }
  return new URL(o.docs!).host;
}

function enrich(o: RawOption, source: 'file' | 'explorer', facts: Facts, cncf: Map<string, CncfLevel>): RegistryOption {
  const key = repoKey(o.repo);
  const fact = key ? facts.get(key) : undefined;
  const known = fact && fact !== 'unknown' ? fact : undefined;
  const urlOwner = o.repo ? /^https?:\/\/github\.com\/([^/]+)\//i.exec(o.repo)?.[1] : undefined;
  const license = o.license ?? known?.license;
  const maintainer = known?.owner ?? urlOwner;
  const description = o.note ?? (o.repo && !isSubdirectory(o.repo) ? known?.description : undefined);
  // OpenTelemetry is itself a CNCF project; a badge on every OTel-owned option would say nothing.
  const level = key && o.tier !== 'otel' ? (cncf.get(key) ?? cncf.get(key.split('/')[0])) : undefined;
  return {
    tier: o.tier,
    label: label(o),
    ...(o.repo ? { repo: o.repo } : {}),
    ...(o.docs ? { docs: o.docs } : {}),
    ...(o.package ? { package: o.package } : {}),
    ...(license ? { license } : {}),
    ...(maintainer ? { maintainer } : {}),
    ...(description ? { description } : {}),
    ...(level ? { cncf: level } : {}),
    source,
  };
}

export function buildRegistry(
  targets: HandTarget[],
  generated: GeneratedTarget[],
  facts: Facts,
  cncf: Map<string, CncfLevel>,
  findings: Finding[],
): RegistryEntry[] {
  const hidden = new Set(findings.map((f) => `${f.file}#${f.option}`));
  const entries = new Map<string, RegistryEntry>();

  for (const g of generated) {
    entries.set(g.id, { id: g.id, kind: 'library', language: g.language, name: g.name, options: [enrich(g.option, 'explorer', facts, cncf)] });
  }
  for (const t of targets) {
    const options = t.options.filter((_, i) => !hidden.has(`${t.file}#${i}`)).map((o) => enrich(o, 'file', facts, cncf));
    const existing = entries.get(t.id);
    if (existing) {
      existing.name = t.name;
      existing.options.push(...options);
    } else if (options.length) {
      entries.set(t.id, { id: t.id, kind: t.kind, ...(t.language ? { language: t.language } : {}), name: t.name, options });
    }
  }

  for (const e of entries.values()) {
    e.options.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || compare(sortKey(a), sortKey(b)));
  }
  return [...entries.values()].sort((a, b) => compare(a.name, b.name) || compare(a.id, b.id));
}
