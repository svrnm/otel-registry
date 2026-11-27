// What happens to marked options over time. The tracking issue is the only place the
// "first failed" dates live, so checks add no commits. One standing pull request always
// holds exactly the options that have been marked for REMOVE_AFTER_DAYS or more.
//
//   node src/registry/lifecycle.ts        (in CI, after the build; needs gh and GH_TOKEN)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dump, load } from 'js-yaml';
import type { Check, Finding } from './checks.ts';

export type Marks = Record<string, { since: string; check: Check; reason: string }>; // key: `${file}#${option}`

export const REMOVE_AFTER_DAYS = 30;
const ISSUE_TITLE = 'Marked entries';
const PR_TITLE = `Remove entries marked for ${REMOVE_AFTER_DAYS} days`;
const BRANCH = 'removals';
const OPEN = '<!-- marks';
const CLOSE = '-->';
const CHECKS: Check[] = ['repo', 'abandoned', 'licence', 'links', 'duplicate'];

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * A finding already marked keeps its date; a new one is marked today; a mark with no finding is dropped.
 * `unknown` lists options that could not be checked this run: their marks are carried over untouched,
 * so a throttled or timed-out request does not clear a mark or restart its clock.
 */
export function updateMarks(prev: Marks, findings: Finding[], today: string, unknown: string[] = []): Marks {
  const next: Marks = {};
  for (const f of findings) {
    const key = `${f.file}#${f.option}`;
    next[key] = { since: prev[key]?.since ?? today, check: f.check, reason: f.reason };
  }
  for (const key of unknown) {
    if (prev[key] && !next[key]) next[key] = prev[key];
  }
  return next;
}

/** The threshold in days from REMOVE_AFTER_DAYS; anything but a non-negative integer means the default. */
export function thresholdDays(value: string | undefined): number {
  return value !== undefined && /^\d+$/.test(value.trim()) ? Number(value) : REMOVE_AFTER_DAYS;
}

// The repo is public, so anyone can open an issue with our title or a pull request from a branch
// with our name. Only the Actions bot's issue and a same-repository pull request are ours.
export function pickIssue<T extends { title: string; author?: { is_bot?: boolean } }>(issues: T[]): T | undefined {
  return issues.find((i) => i.title === ISSUE_TITLE && i.author?.is_bot === true);
}

export function pickPr<T extends { isCrossRepository?: boolean }>(prs: T[]): T | undefined {
  return prs.find((p) => p.isCrossRepository !== true);
}

export function dueForRemoval(marks: Marks, today: string, days = REMOVE_AFTER_DAYS): string[] {
  return Object.keys(marks).filter((k) => addDays(marks[k].since, days) <= today).sort();
}

export function parseIssue(body: string): Marks {
  const start = body.indexOf(OPEN);
  if (start < 0) return {};
  const end = body.indexOf(CLOSE, start);
  let raw: unknown;
  try {
    raw = JSON.parse(body.slice(start + OPEN.length, end));
  } catch {
    return {};
  }
  // The body is editable by people with triage rights; keep only well-formed marks.
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const marks: Marks = {};
  for (const [key, m] of Object.entries(raw as Record<string, any>)) {
    const wellFormed = /^.+\.ya?ml#\d+$/.test(key) && m && typeof m === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(m.since) && !Number.isNaN(Date.parse(m.since)) && CHECKS.includes(m.check) && typeof m.reason === 'string';
    if (wellFormed) marks[key] = { since: m.since, check: m.check, reason: m.reason };
  }
  return marks;
}

export function renderIssue(marks: Marks, today: string): string {
  const keys = Object.keys(marks).sort();
  const rows = keys.map((k) => {
    const [file, option] = k.split('#');
    const m = marks[k];
    return `| \`${file}\` | ${option} | ${m.check} | ${m.reason.replace(/\|/g, '\\|')} | ${m.since} | ${addDays(m.since, REMOVE_AFTER_DAYS)} |`;
  });
  const table = keys.length
    ? ['| File | Option | Check | Reason | Marked since | Removed from |', '|---|---|---|---|---|---|', ...rows].join('\n')
    : 'No entries are marked.';
  return [
    `Options that failed a correctness check. They are hidden from the site. Fix the entry and the mark clears on the next scan; otherwise the option is proposed for removal ${REMOVE_AFTER_DAYS} days after it was first marked.`,
    '',
    `Last scan: ${today}`,
    '',
    table,
    '',
    // Machine-readable state. ">" is escaped so a reason can never close the comment.
    `${OPEN}\n${JSON.stringify(marks).replace(/>/g, '\\u003e')}\n${CLOSE}`,
  ].join('\n');
}

/** Removes the options at the given indexes. Returns the new file text, or null when no option is left. */
export function removeOptions(yamlText: string, indexes: number[]): string | null {
  const doc = load(yamlText) as { name: string; options: unknown[] };
  const options = doc.options.filter((_, i) => !indexes.includes(i));
  return options.length ? dump({ ...doc, options }, { lineWidth: -1, quotingType: '"' }) : null;
}

function main() {
  const report = JSON.parse(readFileSync(process.env.REPORT ?? 'report.json', 'utf8')) as { tokenUsed: boolean; findings: Finding[]; unknown?: string[] };
  if (!report.tokenUsed) {
    console.log('The build ran without a token, so nothing was checked. Leaving marks and removals untouched.');
    return;
  }
  const dataDir = process.env.DATA_DIR ?? 'data';
  const today = new Date().toISOString().slice(0, 10);
  const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

  // 1. Tracking issue.
  const issues = JSON.parse(gh('issue', 'list', '--state', 'open', '--search', `"${ISSUE_TITLE}" in:title author:app/github-actions`, '--json', 'number,title,body,author')) as { number: number; title: string; body: string; author?: { is_bot?: boolean } }[];
  const issue = pickIssue(issues);
  const marks = updateMarks(issue ? parseIssue(issue.body) : {}, report.findings, today, report.unknown ?? []);
  writeFileSync('.marks-issue.md', renderIssue(marks, today));
  if (issue) gh('issue', 'edit', String(issue.number), '--body-file', '.marks-issue.md');
  else gh('issue', 'create', '--title', ISSUE_TITLE, '--body-file', '.marks-issue.md');
  rmSync('.marks-issue.md');
  console.log(`${Object.keys(marks).length} option(s) marked.`);

  // 2. Standing removal pull request, rebuilt from the default branch every time.
  const days = thresholdDays(process.env.REMOVE_AFTER_DAYS);
  const due = dueForRemoval(marks, today, days);
  const byFile = new Map<string, number[]>();
  for (const key of due) {
    const [file, option] = key.split('#');
    byFile.set(file, [...(byFile.get(file) ?? []), Number(option)]);
  }
  const base = git('rev-parse', '--abbrev-ref', 'HEAD');
  git('checkout', '-B', BRANCH);
  for (const [file, indexes] of byFile) {
    const path = join(dataDir, file);
    if (!existsSync(path)) continue;
    const next = removeOptions(readFileSync(path, 'utf8'), indexes);
    if (next === null) rmSync(path);
    else writeFileSync(path, next);
  }
  const ours = pickPr(JSON.parse(gh('pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number,isCrossRepository')) as { number: number; isCrossRepository?: boolean }[]);
  const open = ours ? [ours] : [];
  if (!git('status', '--porcelain', '--', dataDir)) {
    if (open.length) gh('pr', 'close', String(open[0].number), '--comment', 'Nothing is due for removal any more.');
    console.log('Nothing is due for removal.');
  } else {
    const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/workflows/scan.yml` : 'the Scan workflow';
    const body = [
      `These options have been marked for ${days} days or more and nobody followed up. Merging removes them.`,
      '',
      ...due.map((k) => `- \`${k.split('#')[0]}\` option ${k.split('#')[1]}: ${marks[k].reason} (since ${marks[k].since})`),
      '',
      `**Rescan before merging:** run ${runUrl} ("Run workflow"). It rebuilds this pull request, so anything fixed in the meantime drops out.`,
    ].join('\n');
    writeFileSync('.removal-pr.md', body);
    git('add', '--all', '--', dataDir);
    git('-c', 'user.name=otel-registry scan', '-c', 'user.email=noreply@github.com', 'commit', '--quiet', '-m', PR_TITLE);
    git('push', '--force', 'origin', BRANCH);
    if (open.length) gh('pr', 'edit', String(open[0].number), '--body-file', '.removal-pr.md');
    else gh('pr', 'create', '--head', BRANCH, '--base', base, '--title', PR_TITLE, '--body-file', '.removal-pr.md');
    rmSync('.removal-pr.md');
    console.log(`${due.length} option(s) proposed for removal.`);
  }
  git('checkout', '--quiet', base);
}

if (import.meta.main) main();
