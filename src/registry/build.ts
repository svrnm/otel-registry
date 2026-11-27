// CLI: reads data/, the Ecosystem Explorer, GitHub and the CNCF landscape, and writes
// the registry the page renders plus a report of check findings.
//
//   node src/registry/build.ts [--data data] [--explorer <ecosystem-registry dir>]
//        [--out public/registry.json] [--report report.json] [--baseline <tracking issue body>] [--changed <file>...]
//
// Exit codes: 0 ok; 1 invalid files or an unreachable source; 2 a --changed file has a finding that
// the tracking issue (--baseline) does not already list.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { effectiveRepo, loadTargets } from './targets.ts';
import { fetchExplorer, readExplorer, readExplorerMap, resolveGenerated } from './explorer.ts';
import { fetchFacts, fetchLandscape, repoKey } from './facts.ts';
import type { CncfLevel } from './facts.ts';
import { checkLinks, linksToCheck, runChecks, unknownOptions } from './checks.ts';
import type { LinkStatus } from './checks.ts';
import { buildRegistry } from './merge.ts';
import { parseIssue } from './lifecycle.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    data: { type: 'string', default: 'data' },
    explorer: { type: 'string' },
    out: { type: 'string', default: 'public/registry.json' },
    report: { type: 'string', default: 'report.json' },
    baseline: { type: 'string' },
    changed: { type: 'boolean', default: false },
  },
});
const token = process.env.GITHUB_TOKEN || undefined;
// Test-only switch: no CNCF fetch and no link checks, so the suite runs without a network.
const offline = process.env.REGISTRY_OFFLINE === '1';

const write = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(value, null, 1) + '\n');
};

try {
  const targets = loadTargets(values.data);
  const generated = resolveGenerated(readExplorer(values.explorer ?? fetchExplorer('.cache/explorer')), readExplorerMap(values.data));

  const repos = [
    ...targets.flatMap((t) => [t.target, ...t.options.map((o) => effectiveRepo(t.target, o))]),
    ...generated.flatMap((g) => [g.target, g.option.repo]),
  ];
  const keys = [...new Set(repos.map(repoKey).filter((k): k is string => !!k))];
  const facts = await fetchFacts(keys, token);
  const cncf = offline ? new Map<string, CncfLevel>() : await fetchLandscape();
  // Without a token nothing may be marked, so link results would not be used.
  const links = offline || !token ? new Map<string, LinkStatus>() : await checkLinks(linksToCheck(targets));

  const findings = runChecks(targets, generated, facts, links);
  const registry = buildRegistry(targets, generated, facts, cncf, findings);

  const moved = targets.flatMap((t) =>
    t.options.flatMap((o, option) => {
      const fact = facts.get(repoKey(effectiveRepo(t.target, o)) ?? '');
      return fact && fact !== 'unknown' && fact.movedTo ? [{ file: t.file, option, to: fact.movedTo }] : [];
    }),
  );

  // Explorer items nothing says a target for; they show under their own repository until mapped in data/explorer.yml.
  const unmapped = generated.filter((g) => !g.known).map((g) => g.ref);

  write(values.out, registry);
  write(values.report, { generatedAt: new Date().toISOString(), tokenUsed: !!token, findings, unknown: unknownOptions(targets, facts, links), moved, unmapped });

  for (const f of findings) console.log(`marked  ${f.file} option ${f.option}  ${f.check}: ${f.reason}`);
  for (const m of moved) console.log(`moved   ${m.file} option ${m.option}  repository is now ${m.to}`);
  const options = registry.reduce((n, e) => n + e.options.length, 0);
  console.log(`${registry.length} entries, ${options} options, ${findings.length} marked, ${unmapped.length} Explorer items without a known target${token ? '' : ' (no GITHUB_TOKEN: nothing inferred, nothing checked)'}`);

  if (values.changed) {
    // Editing a file must not be blocked by an option in it that is already marked and tracked.
    const marks = values.baseline && existsSync(values.baseline) ? parseIssue(readFileSync(values.baseline, 'utf8')) : {};
    const tracked = new Set(Object.entries(marks).map(([key, m]) => `${key.split('#')[0]}|${m.reason}`));
    const hit = findings.filter((f) => !tracked.has(`${f.file}|${f.reason}`) && positionals.some((p) => p === f.file || p.endsWith(`/${f.file}`)));
    if (hit.length) {
      console.error(`${hit.length} new finding(s) in changed files: ${[...new Set(hit.map((f) => f.file))].join(', ')}`);
      process.exit(2);
    }
  }
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
