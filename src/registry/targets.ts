// Hand-written registry entries: one YAML file per instrumented app or library.
// An entry is identified by its `target`, the most specific stable link to the thing
// that is instrumented. The path only says whether it is an application or which language.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';
import { githubRepo, normalizeUrl } from './display.ts';

export type Tier = 'native' | 'first-party' | 'otel' | 'third-party';
export const TIERS: readonly Tier[] = ['native', 'first-party', 'otel', 'third-party'];

export interface HandOption {
  tier: Tier;
  repo?: string;
  docs?: string;
  package?: string;
  license?: string;
}

export interface HandTarget {
  file: string;
  kind: 'library' | 'application';
  language?: string;
  target: string;
  name?: string;
  options: HandOption[];
}

const url = z.string().regex(/^https?:\/\/\S+$/, 'must be an http(s) URL');
const optionSchema = z.strictObject({
  tier: z.enum(TIERS as [Tier, ...Tier[]]),
  repo: url.optional(),
  docs: url.optional(),
  package: z.string().regex(/^[a-z]+:\S+$/, 'must look like <ecosystem>:<name>').optional(),
  license: z.string().min(1).optional(),
});
const targetSchema = z.strictObject({
  target: url,
  name: z.string().min(1).optional(),
  options: z.array(optionSchema).min(1),
});

const SEGMENT = '[a-z0-9][a-z0-9.-]*';
const PATH = new RegExp(`^(?:libraries/(${SEGMENT})/(${SEGMENT})|applications/(${SEGMENT}))\\.yml$`);
/** Not an entry: says which target an Ecosystem Explorer item instruments. Read by explorer.ts. */
export const EXPLORER_MAP = 'explorer.yml';

/** Two entries are the same thing when they share a language (or are both applications) and a target. */
export function targetKey(t: { language?: string; target: string }): string {
  return `${t.language ?? 'application'}|${normalizeUrl(t.target)}`;
}

/** The repository an option lives in: its own, or for native support the target itself. */
export function effectiveRepo(target: string, option: { tier: Tier; repo?: string }): string | undefined {
  return option.repo ?? (option.tier === 'native' && githubRepo(target) ? target : undefined);
}

/** `file` is relative to the data dir, with forward slashes. Throws an Error that starts with the file name. */
export function parseTarget(file: string, text: string): HandTarget {
  const fail = (problems: string[]): never => {
    throw new Error(`${file}: ${problems.join('; ')}`);
  };
  const m = PATH.exec(file);
  if (!m) fail(['path must be libraries/<language>/<file>.yml or applications/<file>.yml, lower-case with digits, hyphens and dots']);
  const kind = m![3] ? 'application' : 'library';

  let raw: unknown;
  try {
    raw = load(text);
  } catch (e) {
    fail([`invalid YAML: ${(e as Error).message.split('\n')[0]}`]);
  }
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) fail(parsed.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`));

  const { target, name, options } = parsed.data!;
  const problems: string[] = [];
  if (!name && !githubRepo(target)?.root) problems.push('name: required when the target is not a GitHub repository');
  options.forEach((o, i) => {
    const repo = effectiveRepo(target, o as HandOption);
    if (o.tier !== 'native' && !o.repo && !o.docs) problems.push(`options.${i}: needs repo or docs`);
    else if (!repo && kind === 'library') problems.push(`options.${i}: a library option needs a public repo`);
    else if (!repo && o.license !== 'proprietary') problems.push(`options.${i}: without a repo, license must be proprietary`);
    if (o.tier === 'otel' && !/^https?:\/\/github\.com\/open-telemetry\//i.test(o.repo ?? '')) {
      problems.push(`options.${i}: tier otel is only for repositories in the open-telemetry GitHub org`);
    }
  });
  if (problems.length) fail(problems);

  return {
    file,
    kind,
    ...(kind === 'library' ? { language: m![1] } : {}),
    target,
    ...(name ? { name } : {}),
    options: options as HandOption[],
  };
}

/** Reads every entry file under dataDir. Collects all errors, then throws one Error listing them. */
export function loadTargets(dataDir: string): HandTarget[] {
  const files = (readdirSync(dataDir, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => relative(dataDir, join(dataDir, f)).split(sep).join('/'))
    .filter((f) => f !== EXPLORER_MAP);
  const targets: HandTarget[] = [];
  const errors: string[] = [];
  for (const file of files) {
    try {
      targets.push(parseTarget(file, readFileSync(join(dataDir, file), 'utf8')));
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  if (errors.length) throw new Error(`${errors.length} invalid file(s):\n${errors.sort().join('\n')}`);
  return targets.sort((a, b) => a.file.localeCompare(b.file));
}
