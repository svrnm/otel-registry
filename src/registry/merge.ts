// Turns hand-written files, Explorer items, inferred facts and check findings into the
// list the page renders: one entry per target, best option first. An entry carries facts
// only; what can be derived from them (headings, labels, maintainers) is derived where
// it is shown, see display.ts.
import { TIERS, effectiveRepo, targetKey } from './targets.ts';
import type { HandTarget, Tier } from './targets.ts';
import type { GeneratedTarget } from './explorer.ts';
import { githubRepo, heading, optionLabel } from './display.ts';
import { repoKey } from './facts.ts';
import type { CncfLevel, Facts } from './facts.ts';
import type { Finding } from './checks.ts';

export interface RegistryOption {
  tier: Tier;
  repo?: string;
  docs?: string;
  package?: string;
  license?: string;
}

export interface RegistryEntry {
  target: string;
  name?: string;
  language?: string;
  category?: 'application';
  cncf?: CncfLevel;
  options: RegistryOption[];
}

const compare = (a: string, b: string) => a.localeCompare(b, 'en', { sensitivity: 'base' });

function option(target: string, o: { tier: Tier; repo?: string; docs?: string; package?: string; license?: string }, facts: Facts): RegistryOption {
  const fact = facts.get(repoKey(effectiveRepo(target, o)) ?? '');
  const license = o.license ?? (fact && fact !== 'unknown' ? fact.license : undefined);
  return {
    tier: o.tier,
    ...(o.repo ? { repo: o.repo } : {}),
    ...(o.docs ? { docs: o.docs } : {}),
    ...(o.package ? { package: o.package } : {}),
    ...(license ? { license } : {}),
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
  // Keyed by language and target; a written name wins over one taken from the Explorer.
  const entries = new Map<string, RegistryEntry & { written?: boolean }>();
  const entryFor = (t: { language?: string; target: string }) => {
    const key = targetKey(t);
    if (!entries.has(key)) {
      const gh = githubRepo(t.target);
      // OpenTelemetry is itself a CNCF project; a badge on its own repositories would say nothing.
      const level = gh && gh.owner.toLowerCase() !== 'open-telemetry' ? (cncf.get(repoKey(t.target)!) ?? cncf.get(gh.owner.toLowerCase())) : undefined;
      entries.set(key, {
        target: t.target,
        ...(t.language ? { language: t.language } : { category: 'application' as const }),
        ...(level ? { cncf: level } : {}),
        options: [],
      });
    }
    return entries.get(key)!;
  };

  for (const g of generated) {
    const e = entryFor(g);
    // The heading of a repository is its owner/name; anything else needs a name to show.
    if (!githubRepo(e.target)?.root && !e.name) e.name = g.name;
    e.options.push(option(e.target, g.option, facts));
  }
  for (const t of targets) {
    const options = t.options.filter((_, i) => !hidden.has(`${t.file}#${i}`));
    if (!options.length && !entries.has(targetKey(t))) continue;
    const e = entryFor(t);
    if (t.name && !e.written) {
      e.name = t.name;
      e.written = true;
    }
    e.options.push(...options.map((o) => option(e.target, o, facts)));
  }

  const result = [...entries.values()].filter((e) => e.options.length);
  for (const e of result) {
    delete e.written;
    e.options.sort((a, b) => TIERS.indexOf(a.tier) - TIERS.indexOf(b.tier) || compare(optionLabel(a), optionLabel(b)));
  }
  // Key order is part of the output: target first, options last.
  return result
    .map(({ target, name, language, category, cncf: level, options }) => ({
      target,
      ...(name ? { name } : {}),
      ...(language ? { language } : {}),
      ...(category ? { category } : {}),
      ...(level ? { cncf: level } : {}),
      options,
    }))
    .sort((a, b) => compare(heading(a), heading(b)) || compare(a.target, b.target));
}
