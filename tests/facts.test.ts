import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repoKey, isSubdirectory, toFacts, fetchFacts, parseLandscape } from '../src/registry/facts.ts';

const found = (over: object = {}) => ({
  nameWithOwner: 'dotnet/aspnetcore',
  isArchived: false,
  description: 'ASP.NET Core is a cross-platform .NET framework.',
  licenseInfo: { spdxId: 'MIT' },
  owner: { login: 'dotnet' },
  ...over,
});

test('repoKey', () => {
  assert.equal(repoKey('https://github.com/Traefik/traefik/tree/master/x'), 'traefik/traefik');
  assert.equal(repoKey('https://github.com/a/b.git'), 'a/b');
  assert.equal(repoKey('https://gitlab.com/a/b'), undefined);
  assert.equal(repoKey(undefined), undefined);
});

test('isSubdirectory', () => {
  assert.equal(isSubdirectory('https://github.com/a/b/tree/main/packages/x'), true);
  assert.equal(isSubdirectory('https://github.com/a/b'), false);
});

test('toFacts maps a found repo', () => {
  const f = toFacts(['dotnet/aspnetcore'], { r0: found() }, []);
  assert.deepEqual(f.get('dotnet/aspnetcore'), {
    exists: true,
    archived: false,
    license: 'MIT',
    owner: 'dotnet',
    description: 'ASP.NET Core is a cross-platform .NET framework.',
  });
});

test('toFacts: NOT_FOUND means the repo is gone', () => {
  const f = toFacts(['a/gone'], { r0: null }, [{ path: ['r0'], type: 'NOT_FOUND' }]);
  assert.deepEqual(f.get('a/gone'), { exists: false, archived: false, owner: 'a' });
});

test('toFacts: any other error is unknown', () => {
  const f = toFacts(['a/b', 'c/d'], { r0: null, r1: found() }, [{ path: ['r0'], type: 'SERVICE_UNAVAILABLE' }]);
  assert.equal(f.get('a/b'), 'unknown');
  assert.notEqual(f.get('c/d'), 'unknown');
});

test('toFacts: a missing alias is unknown', () => {
  assert.equal(toFacts(['a/b'], {}, []).get('a/b'), 'unknown');
});

test('toFacts: NOASSERTION and a missing licence both mean no licence', () => {
  const f = toFacts(['a/b', 'c/d'], { r0: found({ licenseInfo: { spdxId: 'NOASSERTION' } }), r1: found({ licenseInfo: null }) }, []);
  assert.equal((f.get('a/b') as any).license, undefined);
  assert.equal((f.get('c/d') as any).license, undefined);
});

test('toFacts: archived repo', () => {
  assert.equal((toFacts(['a/b'], { r0: found({ isArchived: true }) }, []).get('a/b') as any).archived, true);
});

test('toFacts: renamed repo sets movedTo', () => {
  const f = toFacts(['old/name'], { r0: found({ nameWithOwner: 'New/Name' }) }, []);
  assert.equal((f.get('old/name') as any).movedTo, 'New/Name');
  assert.equal((toFacts(['dotnet/aspnetcore'], { r0: found() }, []).get('dotnet/aspnetcore') as any).movedTo, undefined);
});

test('fetchFacts without token returns unknown and makes no request', async () => {
  let called = false;
  const f = await fetchFacts(['a/b'], undefined, async () => {
    called = true;
    return new Response('{}');
  });
  assert.equal(f.get('a/b'), 'unknown');
  assert.equal(called, false);
});

test('fetchFacts with token asks in batches of 50 and maps the answers', async () => {
  const keys = Array.from({ length: 51 }, (_, i) => `o/r${i}`);
  const bodies: string[] = [];
  const f = await fetchFacts(keys, 't', async (_url, init) => {
    bodies.push(String(init?.body));
    const n = (String(init?.body).match(/repository\(/g) ?? []).length;
    const data = Object.fromEntries(Array.from({ length: n }, (_, i) => [`r${i}`, found()]));
    return new Response(JSON.stringify({ data }));
  });
  assert.equal(bodies.length, 2);
  assert.equal(f.size, 51);
  assert.equal((f.get('o/r50') as any).license, 'MIT');
});

test('fetchFacts with token rejects on HTTP 502', async () => {
  await assert.rejects(fetchFacts(['a/b'], 't', async () => new Response('bad gateway', { status: 502 })), /GitHub/);
});

test('fetchFacts with token rejects when fetch throws', async () => {
  await assert.rejects(
    fetchFacts(['a/b'], 't', async () => {
      throw new Error('socket hang up');
    }),
  );
});

test('parseLandscape reads project level by repo and org, skipping archived', () => {
  const text = [
    'landscape:',
    '  - category:',
    '    name: Runtime',
    '    subcategories:',
    '      - subcategory:',
    '        name: Service Mesh',
    '        items:',
    '          - item:',
    '            name: Dapr',
    '            project: graduated',
    '            repo_url: https://github.com/dapr/dapr',
    '          - item:',
    '            name: Gone',
    '            project: archived',
    '            repo_url: https://github.com/gone/gone',
    '          - item:',
    '            name: Vendor Thing',
    '            repo_url: https://github.com/vendor/thing',
  ].join('\n');
  const m = parseLandscape(text);
  assert.equal(m.get('dapr/dapr'), 'graduated');
  assert.equal(m.get('dapr'), 'graduated');
  assert.equal(m.has('gone/gone'), false);
  assert.equal(m.has('vendor/thing'), false);
});
