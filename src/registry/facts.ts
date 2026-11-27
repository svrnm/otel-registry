// Facts inferred at build time: repo state from GitHub, CNCF status from the CNCF landscape.
// Nothing here is ever written back to data/.
import { load } from 'js-yaml';

export interface RepoFacts {
  exists: boolean;
  archived: boolean;
  license?: string;
  owner: string;
  description?: string;
  movedTo?: string;
}
/** Keyed by repoKey(). 'unknown' means GitHub gave no definite answer, so nothing may be concluded. */
export type Facts = Map<string, RepoFacts | 'unknown'>;
export type CncfLevel = 'sandbox' | 'incubating' | 'graduated';

const GITHUB_REPO = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s#?]+)/i;

export function repoKey(url: string | undefined): string | undefined {
  const m = url ? GITHUB_REPO.exec(url) : null;
  return m ? `${m[1]}/${m[2].replace(/\.git$/, '')}`.toLowerCase() : undefined;
}

export function isSubdirectory(url: string): boolean {
  return /\/(tree|blob)\/[^/]+\/.+/.test(url);
}

export function toFacts(keys: string[], data: Record<string, any>, errors: { path?: (string | number)[]; type?: string }[]): Facts {
  const facts: Facts = new Map();
  keys.forEach((key, i) => {
    const alias = `r${i}`;
    const repo = data?.[alias];
    if (repo) {
      const spdx = repo.licenseInfo?.spdxId;
      facts.set(key, {
        exists: true,
        archived: repo.isArchived === true,
        ...(spdx && spdx !== 'NOASSERTION' ? { license: spdx } : {}),
        owner: repo.owner?.login ?? key.split('/')[0],
        ...(repo.description ? { description: repo.description } : {}),
        ...(repo.nameWithOwner && repo.nameWithOwner.toLowerCase() !== key ? { movedTo: repo.nameWithOwner } : {}),
      });
    } else if (errors.some((e) => e.path?.[0] === alias && e.type === 'NOT_FOUND')) {
      facts.set(key, { exists: false, archived: false, owner: key.split('/')[0] });
    } else {
      facts.set(key, 'unknown');
    }
  });
  return facts;
}

const BATCH = 50;

/** Without a token, every repo is 'unknown' and no request is made. With one, any transport failure rejects. */
export async function fetchFacts(keys: string[], token?: string, fetchImpl: typeof fetch = fetch): Promise<Facts> {
  if (!token) return new Map(keys.map((k) => [k, 'unknown' as const]));
  const facts: Facts = new Map();
  for (let i = 0; i < keys.length; i += BATCH) {
    const chunk = keys.slice(i, i + BATCH);
    const query = `query{${chunk
      .map((k, j) => {
        const [owner, name] = k.split('/');
        return `r${j}:repository(owner:${JSON.stringify(owner)},name:${JSON.stringify(name)}){nameWithOwner isArchived description licenseInfo{spdxId} owner{login}}`;
      })
      .join(' ')}}`;
    const res = await fetchImpl('https://api.github.com/graphql', {
      method: 'POST',
      headers: { authorization: `bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'otel-registry' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error(`GitHub GraphQL request failed with HTTP ${res.status}`);
    const body = (await res.json()) as { data?: Record<string, any>; errors?: any[] };
    if (!body.data) throw new Error(`GitHub GraphQL returned no data: ${JSON.stringify(body.errors ?? body).slice(0, 200)}`);
    for (const [k, v] of toFacts(chunk, body.data, body.errors ?? [])) facts.set(k, v);
  }
  return facts;
}

const LEVELS: CncfLevel[] = ['sandbox', 'incubating', 'graduated'];

/** Maps 'owner/name' and 'owner' to the CNCF project level. For an org with several projects the highest level wins. */
export function parseLandscape(text: string): Map<string, CncfLevel> {
  const levels = new Map<string, CncfLevel>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const item = node as Record<string, unknown>;
    const key = LEVELS.includes(item.project as CncfLevel) ? repoKey(item.repo_url as string) : undefined;
    if (key) {
      const level = item.project as CncfLevel;
      const org = key.split('/')[0];
      levels.set(key, level);
      if (LEVELS.indexOf(level) > LEVELS.indexOf(levels.get(org) ?? 'sandbox') || !levels.has(org)) levels.set(org, level);
    }
    Object.values(item).forEach(walk);
  };
  walk(load(text));
  return levels;
}

export async function fetchLandscape(fetchImpl: typeof fetch = fetch): Promise<Map<string, CncfLevel>> {
  const res = await fetchImpl('https://raw.githubusercontent.com/cncf/landscape/master/landscape.yml', { headers: { 'user-agent': 'otel-registry' } });
  if (!res.ok) throw new Error(`CNCF landscape request failed with HTTP ${res.status}`);
  return parseLandscape(await res.text());
}
