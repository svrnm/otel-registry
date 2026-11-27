// Hand-written registry entries: one YAML file per instrumented app or library.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';

export type Tier = 'native' | 'first-party' | 'otel' | 'third-party';
export const TIERS: readonly Tier[] = ['native', 'first-party', 'otel', 'third-party'];

export interface HandOption {
  tier: Tier;
  repo?: string;
  docs?: string;
  package?: string;
  license?: string;
  note?: string;
}

export interface HandTarget {
  id: string;
  file: string;
  kind: 'library' | 'application';
  language?: string;
  name: string;
  options: HandOption[];
}

const url = z.string().regex(/^https?:\/\/\S+$/, 'must be an http(s) URL');
const optionSchema = z.strictObject({
  tier: z.enum(TIERS as [Tier, ...Tier[]]),
  repo: url.optional(),
  docs: url.optional(),
  package: z.string().regex(/^[a-z]+:\S+$/, 'must look like <ecosystem>:<name>').optional(),
  license: z.string().min(1).optional(),
  note: z.string().min(1).optional(),
});
const targetSchema = z.strictObject({
  name: z.string().min(1),
  options: z.array(optionSchema).min(1),
});

const SEGMENT = '[a-z0-9][a-z0-9.-]*';
const PATH = new RegExp(`^(?:libraries/(${SEGMENT})/(${SEGMENT})|applications/(${SEGMENT}))\\.yml$`);

/** `file` is relative to the data dir, with forward slashes. Throws an Error that starts with the file name. */
export function parseTarget(file: string, text: string): HandTarget {
  const fail = (problems: string[]): never => {
    throw new Error(`${file}: ${problems.join('; ')}`);
  };
  const m = PATH.exec(file);
  if (!m) fail(['path must be libraries/<language>/<target>.yml or applications/<target>.yml, lower-case with digits, hyphens and dots']);
  const kind = m![3] ? 'application' : 'library';

  let raw: unknown;
  try {
    raw = load(text);
  } catch (e) {
    fail([`invalid YAML: ${(e as Error).message.split('\n')[0]}`]);
  }
  const parsed = targetSchema.safeParse(raw);
  if (!parsed.success) fail(parsed.error.issues.map((i) => `${i.path.join('.') || 'file'}: ${i.message}`));

  const { name, options } = parsed.data!;
  const problems: string[] = [];
  options.forEach((o, i) => {
    if (!o.repo && !o.docs) problems.push(`options.${i}: needs repo or docs`);
    else if (!o.repo && kind === 'library') problems.push(`options.${i}: a library option needs a public repo`);
    else if (!o.repo && o.license !== 'proprietary') problems.push(`options.${i}: without a repo, license must be proprietary`);
  });
  if (problems.length) fail(problems);

  return {
    id: file.replace(/\.yml$/, ''),
    file,
    kind,
    ...(kind === 'library' ? { language: m![1] } : {}),
    name,
    options: options as HandOption[],
  };
}

/** Reads every .yml under dataDir. Collects all errors, then throws one Error listing them. */
export function loadTargets(dataDir: string): HandTarget[] {
  const files = (readdirSync(dataDir, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => relative(dataDir, join(dataDir, f)).split(sep).join('/'));
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
  return targets.sort((a, b) => a.id.localeCompare(b.id));
}
