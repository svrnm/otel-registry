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

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** A finding already marked keeps its date; a new one is marked today; a mark with no finding is dropped. */
export function updateMarks(prev: Marks, findings: Finding[], today: string): Marks {
  const next: Marks = {};
  for (const f of findings) {
    const key = `${f.file}#${f.option}`;
    next[key] = { since: prev[key]?.since ?? today, check: f.check, reason: f.reason };
  }
  return next;
}

export function dueForRemoval(marks: Marks, today: string, days = REMOVE_AFTER_DAYS): string[] {
  return Object.keys(marks).filter((k) => addDays(marks[k].since, days) <= today).sort();
}

export function parseIssue(body: string): Marks {
  const start = body.indexOf(OPEN);
  if (start < 0) return {};
  const end = body.indexOf(CLOSE, start);
  try {
    return JSON.parse(body.slice(start + OPEN.length, end));
  } catch {
    return {};
  }
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
  const report = JSON.parse(readFileSync(process.env.REPORT ?? 'report.json', 'utf8')) as { tokenUsed: boolean; findings: Finding[] };
  if (!report.tokenUsed) {
    console.log('The build ran without a token, so nothing was checked. Leaving marks and removals untouched.');
    return;
  }
  const dataDir = process.env.DATA_DIR ?? 'data';
  const today = new Date().toISOString().slice(0, 10);
  const gh = (...args: string[]) => execFileSync('gh', args, { encoding: 'utf8' }).trim();
  const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

  // 1. Tracking issue.
  const issues = JSON.parse(gh('issue', 'list', '--state', 'open', '--search', `"${ISSUE_TITLE}" in:title`, '--json', 'number,title,body')) as { number: number; title: string; body: string }[];
  const issue = issues.find((i) => i.title === ISSUE_TITLE);
  const marks = updateMarks(issue ? parseIssue(issue.body) : {}, report.findings, today);
  writeFileSync('.marks-issue.md', renderIssue(marks, today));
  if (issue) gh('issue', 'edit', String(issue.number), '--body-file', '.marks-issue.md');
  else gh('issue', 'create', '--title', ISSUE_TITLE, '--body-file', '.marks-issue.md');
  rmSync('.marks-issue.md');
  console.log(`${Object.keys(marks).length} option(s) marked.`);

  // 2. Standing removal pull request, rebuilt from the default branch every time.
  const due = dueForRemoval(marks, today);
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
  const open = JSON.parse(gh('pr', 'list', '--head', BRANCH, '--state', 'open', '--json', 'number')) as { number: number }[];
  if (!git('status', '--porcelain', '--', dataDir)) {
    if (open.length) gh('pr', 'close', String(open[0].number), '--comment', 'Nothing is due for removal any more.');
    console.log('Nothing is due for removal.');
  } else {
    const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/workflows/scan.yml` : 'the Scan workflow';
    const body = [
      `These options have been marked for ${REMOVE_AFTER_DAYS} days or more and nobody followed up. Merging removes them.`,
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
