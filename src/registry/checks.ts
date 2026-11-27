// Correctness checks for hand-written options. A check fails only on a definite answer:
// unknown facts or an unreachable link never mark an option.
import { effectiveRepo, targetKey } from './targets.ts';
import type { HandTarget } from './targets.ts';
import type { GeneratedTarget } from './explorer.ts';
import { isSubdirectory, repoKey } from './facts.ts';
import type { Facts } from './facts.ts';

export type Check = 'repo' | 'abandoned' | 'licence' | 'links' | 'duplicate';
export interface Finding {
  file: string;
  option: number;
  check: Check;
  reason: string;
}
export type LinkStatus = 'ok' | 'dead' | 'unknown';

const norm = (url: string) => url.toLowerCase().replace(/\/+$/, '');
/** A repo link needs its own HTTP check when GitHub's repo facts cannot vouch for it. */
const needsLinkCheck = (repo: string) => !repoKey(repo) || isSubdirectory(repo);

export function linksToCheck(targets: HandTarget[]): string[] {
  const urls = new Set<string>();
  for (const t of targets) {
    for (const o of t.options) {
      if (o.docs) urls.add(o.docs);
      if (o.repo && needsLinkCheck(o.repo)) urls.add(o.repo);
    }
  }
  return [...urls];
}

/** `file#option` keys for options where GitHub or a link gave no definite answer this run. */
export function unknownOptions(targets: HandTarget[], facts: Facts, links: Map<string, LinkStatus>): string[] {
  const definite = (url: string) => links.get(url) === 'ok' || links.get(url) === 'dead';
  const keys: string[] = [];
  for (const t of targets) {
    t.options.forEach((o, option) => {
      const key = repoKey(effectiveRepo(t.target, o));
      const fact = key ? facts.get(key) : undefined;
      const repoUnknown = !!key && (!fact || fact === 'unknown');
      const linkUnknown = (!!o.docs && !definite(o.docs)) || (!!o.repo && needsLinkCheck(o.repo) && !definite(o.repo));
      if (repoUnknown || linkUnknown) keys.push(`${t.file}#${option}`);
    });
  }
  return keys.sort();
}

const CONCURRENCY = 8;
const TIMEOUT_MS = 15_000;

export async function checkLinks(urls: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, LinkStatus>> {
  const result = new Map<string, LinkStatus>();
  const queue = [...urls];
  const worker = async () => {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      try {
        const res = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'otel-registry link check' } });
        result.set(url, res.status < 400 ? 'ok' : res.status === 404 || res.status === 410 ? 'dead' : 'unknown');
      } catch {
        result.set(url, 'unknown');
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return result;
}

/** At most one finding per option; the first matching rule wins. */
export function runChecks(targets: HandTarget[], generated: GeneratedTarget[], facts: Facts, links: Map<string, LinkStatus>): Finding[] {
  const generatedByKey = new Map(generated.map((g) => [targetKey(g), g.option]));
  const findings: Finding[] = [];
  // Several files may describe one target; what they have already listed is shared.
  const seen = new Map<string, { repos: Set<string>; packages: Set<string> }>();

  for (const t of targets) {
    const key = targetKey(t);
    if (!seen.has(key)) seen.set(key, { repos: new Set(), packages: new Set() });
    const { repos: seenRepos, packages: seenPackages } = seen.get(key)!;
    const gen = generatedByKey.get(key);

    t.options.forEach((o, option) => {
      const add = (check: Check, reason: string) => findings.push({ file: t.file, option, check, reason });
      const repo = o.repo ? norm(o.repo) : undefined;
      const key = repoKey(effectiveRepo(t.target, o));
      const fact = key ? facts.get(key) : undefined;
      const known = fact && fact !== 'unknown' ? fact : undefined;

      const repeatsSibling = (repo && seenRepos.has(repo)) || (o.package && seenPackages.has(o.package));
      // The Explorer is the source for OTel-owned options: a hand-written copy of the same package
      // or link is the interim one. A different package from the same repository is not a copy;
      // one target can have several.
      const repeatsGenerated = gen && ((o.package && o.package === gen.package) || (repo && repo === norm(gen.repo)));
      if (repo) seenRepos.add(repo);
      if (o.package) seenPackages.add(o.package);

      if (repeatsSibling) return add('duplicate', 'same repo or package as an earlier option of this target');
      if (repeatsGenerated) return add('duplicate', 'the Ecosystem Explorer already provides this option');
      if (known && !known.exists) return add('repo', `repository ${key} no longer exists`);
      if (o.repo && !repoKey(o.repo) && links.get(o.repo) === 'dead') return add('repo', `repository link does not resolve: ${o.repo}`);
      if (known?.archived) return add('abandoned', `repository ${key} is archived`);
      if (known && !known.license && !o.license) return add('licence', `no licence detected in ${key} and none declared`);
      if (o.docs && links.get(o.docs) === 'dead') return add('links', `docs link does not resolve: ${o.docs}`);
      if (o.repo && repoKey(o.repo) && links.get(o.repo) === 'dead') return add('links', `repo link does not resolve: ${o.repo}`);
    });
  }
  return findings;
}
