# OTel Registry Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A standalone, public prototype of the OpenTelemetry registry: one YAML file per instrumented app or library, a build script that merges Ecosystem Explorer data, infers facts and runs correctness checks, and a static page that is a visual copy of today's registry.

**Architecture:** Everything durable lives in `src/registry/` as plain TypeScript with no Astro imports; its CLI writes `public/registry.json` and `report.json`. One Astro page renders that JSON and loads a client-side search script. A second CLI maintains the tracking issue and the standing removal pull request from `report.json`.

**Tech Stack:** Node 26 (runs TypeScript natively, tests with `node --test`), npm, Astro 7 static output, Bootstrap 5.3, MiniSearch 7, zod 4, js-yaml, sass, Font Awesome free. GitHub Actions, Netlify.

**Spec:** `docs/design.md`

## Global Constraints

- Nothing under `src/registry/` or `scripts/` imports from `astro` or from `src/pages`, `src/components`.
- Tiers, in order: `native`, `first-party`, `otel`, `third-party`.
- Paths are the identity: `data/libraries/<language>/<target>.yml`, `data/applications/<target>.yml`; lower-case, digits, hyphens and dots only.
- Hand-written fields are exactly: `name`; per option `tier`, `repo`, `docs`, `package`, `license`, `note`. Unknown fields fail validation. Each option needs `repo` or `docs`.
- Only `applications/` options may omit `repo`; they then need `license: proprietary`.
- Inferred facts are never written to `data/`.
- A network or API error never marks an option. Only a definite answer does.
- Without `GITHUB_TOKEN` the build succeeds, infers nothing and marks nothing.
- If the Explorer repo or the CNCF landscape cannot be fetched, or GitHub fails when a token is set, the build exits non-zero.
- The page carries a visible "Prototype" banner.
- No dependency beyond those in Tech Stack without a line in this plan.
- Removal threshold: 30 days marked.

## Review Focus

1. **No token:** build exits 0, every option is present, no finding is reported. (Task 3, Task 5)
2. **GitHub answers for some repos and errors for others:** the errored ones are `unknown`, not marked. (Task 3, Task 4)
3. **Explorer layout change:** an ecosystem directory that yields zero targets makes the build fail with the ecosystem named. (Task 2)
4. **Mixed target:** one marked option and one good option leaves the target visible with the good one; a target whose only option is marked is absent. (Task 5)
5. **Old deep links:** `?language=js&component=instrumentation` applies the language filter and ignores `component`; `?s=redis` fills the search box. (Task 7)

---

## Milestone 1: preview

### Task 1: Scaffold, schema and loader

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.nvmrc`
- Create: `src/registry/targets.ts`
- Test: `tests/targets.test.ts`, fixtures under `tests/fixtures/data/`

**Interfaces:**
- Produces:

```ts
export type Tier = 'native' | 'first-party' | 'otel' | 'third-party';
export const TIERS: readonly Tier[];
export interface HandOption { tier: Tier; repo?: string; docs?: string; package?: string; license?: string; note?: string }
export interface HandTarget { id: string; file: string; kind: 'library' | 'application'; language?: string; name: string; options: HandOption[] }
export function parseTarget(file: string, text: string): HandTarget; // file is relative to the data dir; throws Error starting with the file name
export function loadTargets(dataDir: string): HandTarget[];          // sorted by id; collects every error, then throws one Error listing them all
```

`id` is the path without `data/` and `.yml`, for example `libraries/dotnet/aspnetcore`.

- [ ] **Step 1: `git init`, write `package.json`** with scripts `test` (`node --test tests/`), `data` (`node src/registry/build.ts`), `dev`, `build` (`npm run data && astro build`), and the dependencies from Tech Stack. `npm install`.
- [ ] **Step 2: Write failing tests**

```ts
test('parses a library file', () => {
  const t = parseTarget('libraries/dotnet/aspnetcore.yml', 'name: ASP.NET Core\noptions:\n  - tier: native\n    repo: https://github.com/dotnet/aspnetcore\n');
  assert.deepEqual([t.id, t.kind, t.language, t.name], ['libraries/dotnet/aspnetcore', 'library', 'dotnet', 'ASP.NET Core']);
});
test('application has no language', () => assert.equal(parseTarget('applications/traefik-proxy.yml', APP).language, undefined));
test('rejects unknown field', () => assert.throws(() => parseTarget('applications/x.yml', 'name: X\nwebsite: https://x\noptions:\n  - tier: native\n    docs: https://x\n    license: proprietary\n'), /applications\/x\.yml/));
test('rejects option without repo or docs', ...);
test('rejects library option without repo', ...);            // docs-only is applications only
test('rejects docs-only application option without license: proprietary', ...);
test('rejects bad tier', ...);
test('rejects path with space or upper case', () => assert.throws(() => parseTarget('applications/Kong Mesh.yml', APP)));
test('rejects path outside libraries/<lang>/ or applications/', ...);
test('loadTargets reports all bad files at once', ...);       // two bad fixtures, both names in the message
```

- [ ] **Step 3: Run `npm test`**, expect failures for missing module.
- [ ] **Step 4: Implement `targets.ts`** with a strict zod schema and `js-yaml`.
- [ ] **Step 5: Run `npm test`**, expect pass. Commit.

### Task 2: Explorer adapters

**Files:**
- Create: `src/registry/explorer.ts`
- Test: `tests/explorer.test.ts`, fixtures under `tests/fixtures/explorer/ecosystem-registry/`

**Interfaces:**
- Produces:

```ts
export interface GeneratedTarget { id: string; language: string; name: string; option: { tier: 'otel'; repo: string; package?: string; note?: string } }
export function slug(s: string): string;                 // lower-case, runs of other characters become one hyphen, trimmed
export function readExplorer(registryDir: string): GeneratedTarget[]; // registryDir = <explorer checkout>/ecosystem-registry
export function fetchExplorer(cacheDir: string): string; // shallow git clone into cacheDir, returns the ecosystem-registry path; throws on failure
```

Adapter rules, each reading only the highest version (numeric-aware sort):

| Ecosystem | Source | Target id | Name | Option |
|---|---|---|---|---|
| Java | `java/javaagent/<v>/instrumentation.yaml`, `libraries[]` | `libraries/java/<slug(display_name)>`, modules with the same display name merged | `display_name` | repo `https://github.com/open-telemetry/opentelemetry-java-instrumentation/tree/main/<common parent of source_path>`, note = first module's `description` |
| JavaScript | `javascript/<pkg>/<v>.yaml` | `libraries/js/<pkg without leading "instrumentation-">` (`browser-instrumentation` becomes `browser`) | the same string | repo `https://github.com/<repository>/tree/main/<source_path>`, package `npm:<npm_package>`, note = `description` |
| Python | `python/<pkg>/<v>.yaml` | `libraries/python/<pkg without "opentelemetry-instrumentation-">` | the same string | repo from `repository` + `source_path`, package `pypi:<name>`, note = `description` |
| .NET | `dotnet/<v>/instrumentation.yaml`, `modules[]` whose `name` starts with `OpenTelemetry.Instrumentation.` | `libraries/dotnet/<slug(rest of name)>` | rest of name | repo `https://github.com/open-telemetry/opentelemetry-dotnet-contrib/tree/main/src/<name>`, package `nuget:<name>`, note = `description` |

- [ ] **Step 1: Build fixtures** by copying three real items per ecosystem from the Explorer repo (two versions of one item, so "latest" is exercised; for Java include `spring-webmvc-3.1`, `spring-webmvc-6.0` and `jdbc`).
- [ ] **Step 2: Write failing tests**

```ts
test('java modules with one display name become one target', () => {
  const t = readExplorer(FIX).filter(x => x.language === 'java');
  assert.deepEqual(t.map(x => x.id), ['libraries/java/jdbc', 'libraries/java/spring-webmvc']);
  assert.equal(t[1].name, 'Spring WebMVC');
  assert.match(t[1].option.repo, /tree\/main\/instrumentation\/spring\/spring-webmvc$/);
});
test('js strips the instrumentation- prefix and reads the latest version', ...); // id libraries/js/winston, package npm:@opentelemetry/instrumentation-winston
test('python strips opentelemetry-instrumentation-', ...);                       // id libraries/python/wsgi, package pypi:opentelemetry-instrumentation-wsgi
test('dotnet keeps only OpenTelemetry.Instrumentation.* modules', ...);          // AutoInstrumentation.Loader absent
test('an ecosystem with zero targets throws naming the ecosystem', () => assert.throws(() => readExplorer(EMPTY_PYTHON), /python/));
test('slug', () => assert.equal(slug('Spring WebMVC'), 'spring-webmvc'));
```

- [ ] **Step 3: Run**, expect fail. **Step 4: Implement.** **Step 5: Run**, expect pass. Commit.

### Task 3: Facts from GitHub and the CNCF landscape

**Files:**
- Create: `src/registry/facts.ts`
- Test: `tests/facts.test.ts`

**Interfaces:**
- Produces:

```ts
export interface RepoFacts { exists: boolean; archived: boolean; license?: string; owner: string; description?: string; movedTo?: string }
export type Facts = Map<string, RepoFacts | 'unknown'>;            // key: repoKey()
export type CncfLevel = 'sandbox' | 'incubating' | 'graduated';
export function repoKey(url: string | undefined): string | undefined; // 'owner/name' lower-case for github.com URLs, else undefined
export function isSubdirectory(url: string): boolean;                // true for /tree/ or /blob/ paths
export function toFacts(keys: string[], data: Record<string, unknown>, errors: { path: string[]; type?: string }[]): Facts;
export async function fetchFacts(keys: string[], token?: string, fetchImpl?: typeof fetch): Promise<Facts>;
export function parseLandscape(text: string): Map<string, CncfLevel>; // keys: 'owner/name' and 'owner'
export async function fetchLandscape(fetchImpl?: typeof fetch): Promise<Map<string, CncfLevel>>;
```

- `fetchFacts` batches 50 repos per GraphQL query (`nameWithOwner isArchived description licenseInfo{spdxId} owner{login}`).
- `toFacts` mapping: alias present gives facts; alias null with a `NOT_FOUND` error gives `exists: false`; anything else gives `'unknown'`. `licenseInfo.spdxId` of `NOASSERTION` or a missing `licenseInfo` gives `license: undefined`. A different `nameWithOwner` sets `movedTo`.
- No token: returns every key as `'unknown'` without calling `fetchImpl`.
- With a token, a non-200 response or a thrown fetch rejects the promise.
- `parseLandscape` walks the YAML for items with `project` in the three levels and a `repo_url`; `archived` projects are skipped.

- [ ] **Step 1: Write failing tests**

```ts
test('repoKey', () => { assert.equal(repoKey('https://github.com/Traefik/traefik/tree/master/x'), 'traefik/traefik'); assert.equal(repoKey('https://gitlab.com/a/b'), undefined); });
test('toFacts maps a found repo', ...);            // license 'MIT', archived false, owner 'dotnet'
test('toFacts: NOT_FOUND means the repo is gone', ...);     // exists false
test('toFacts: any other error is unknown', ...);  // 'unknown'
test('toFacts: NOASSERTION means no licence', ...);
test('toFacts: renamed repo sets movedTo', ...);
test('fetchFacts without token returns unknown and makes no request', async () => { let called = false; const f = await fetchFacts(['a/b'], undefined, async () => { called = true; return new Response('{}'); }); assert.equal(f.get('a/b'), 'unknown'); assert.equal(called, false); });
test('fetchFacts with token rejects on HTTP 502', ...);
test('parseLandscape reads project level by repo and org', ...); // dapr/dapr -> graduated, 'dapr' -> graduated
```

- [ ] **Step 2: Run**, expect fail. **Step 3: Implement.** **Step 4: Run**, expect pass. Commit.

### Task 4: Checks

**Files:**
- Create: `src/registry/checks.ts`
- Test: `tests/checks.test.ts`

**Interfaces:**
- Consumes: `HandTarget`, `GeneratedTarget`, `Facts`, `repoKey`.
- Produces:

```ts
export type Check = 'repo' | 'abandoned' | 'licence' | 'links' | 'duplicate';
export interface Finding { file: string; option: number; check: Check; reason: string }
export type LinkStatus = 'ok' | 'dead' | 'unknown';
export async function checkLinks(urls: string[], fetchImpl?: typeof fetch): Promise<Map<string, LinkStatus>>;
export function runChecks(targets: HandTarget[], generated: GeneratedTarget[], facts: Facts, links: Map<string, LinkStatus>): Finding[];
```

- `checkLinks`: GET with a 15 s timeout, 8 at a time. 2xx and 3xx are `ok`; 404 and 410 are `dead`; everything else, including a thrown fetch, is `unknown`.
- `runChecks`, per option, at most one finding, first match wins:
  1. `duplicate`: same `repo` URL or same `package` as an earlier option of the same target, or as the generated option with the same target id.
  2. `repo`: facts say `exists: false`.
  3. `abandoned`: facts say `archived: true`.
  4. `licence`: facts known, no detected licence, and no `license` field.
  5. `links`: `docs` is `dead`.
- Facts `'unknown'` or link `unknown` never produce a finding.

- [ ] **Step 1: Write failing tests**, one per rule plus:

```ts
test('unknown facts produce no finding', ...);
test('declared license satisfies the licence check', ...);
test('hand-written otel option duplicating the generated one is marked', ...); // check 'duplicate', option index of the hand-written one
test('403, 429, 500 and a network error are unknown, 404 and 410 are dead', ...);
```

- [ ] **Step 2: Run**, expect fail. **Step 3: Implement.** **Step 4: Run**, expect pass. Commit.

### Task 5: Merge and the build CLI

**Files:**
- Create: `src/registry/merge.ts`, `src/registry/build.ts`
- Test: `tests/merge.test.ts`, `tests/build.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1 to 4.
- Produces:

```ts
export interface RegistryOption { tier: Tier; label: string; repo?: string; docs?: string; package?: string; license?: string; maintainer?: string; description?: string; cncf?: CncfLevel; source: 'file' | 'explorer' }
export interface RegistryEntry { id: string; kind: 'library' | 'application'; language?: string; name: string; options: RegistryOption[] }
export function buildRegistry(targets: HandTarget[], generated: GeneratedTarget[], facts: Facts, cncf: Map<string, CncfLevel>, findings: Finding[]): RegistryEntry[];
```

- Options named in `findings` are left out. A target with no option left is left out.
- A generated target and a hand-written target with the same id become one entry; the hand-written `name` wins.
- Sort options by tier order, then by `package` or else `repo` or else `docs`, case-insensitive. Sort entries by `name`, case-insensitive.
- `label`: package name without its ecosystem prefix, else `owner/name` plus the last path segment for subdirectory repos, else the docs host.
- `description`: `note`, else the repo description unless the repo link is a subdirectory.
- `license`: the `license` field, else the detected one. `maintainer`: repo owner. `cncf`: by repo key, else by owner.
- `build.ts` CLI: `node src/registry/build.ts [--data data] [--explorer <dir>] [--out public/registry.json] [--report report.json] [--changed <file>...]`. Without `--explorer` it calls `fetchExplorer('.cache/explorer')`. Exit codes: 1 for schema errors or unreachable sources; 2 when `--changed` is given and any finding is on a listed file; else 0. It prints one line per finding.
- `report.json`: `{ generatedAt: string, tokenUsed: boolean, findings: Finding[], moved: { file: string; option: number; to: string }[] }`.

- [ ] **Step 1: Write failing tests**

```ts
test('marked option is hidden, good sibling stays', ...);               // Review Focus 4
test('target with only a marked option is absent', ...);                // Review Focus 4
test('generated and hand-written targets with one id merge, native first', ...); // tiers ['native','otel']
test('same tier sorts alphabetically by package', ...);
test('subdirectory repo does not take the repo description', ...);
test('cncf level falls back to the org', ...);
test('build without token exits 0, keeps all options, reports no findings', ...); // Review Focus 1; runs the CLI on fixtures with --explorer and GITHUB_TOKEN unset
test('build exits 2 when a --changed file has a finding', ...);          // duplicate fixture, no network needed
test('build exits 1 on a schema error and names the file', ...);
```

`build.test.ts` runs the CLI as a child process with `REGISTRY_OFFLINE=1`, which skips the CNCF fetch and link checks; this variable is for tests only.

- [ ] **Step 2: Run**, expect fail. **Step 3: Implement.** **Step 4: Run**, expect pass. Commit.

### Task 6: Convert today's registry

**Files:**
- Create: `scripts/convert.ts` (throwaway, no tests beyond a count assertion at the end of the script)
- Create: `data/**`

**Interfaces:**
- Consumes: `slug`, `readExplorer`, `fetchFacts`, `repoKey`, `isSubdirectory`.
- CLI: `node scripts/convert.ts <opentelemetry.io>/data/registry <explorer>/ecosystem-registry data`

Rules:

- Keep `registryType` `instrumentation` and `application integration`. Drop the 14 misfits by an explicit key list in the script: entries whose key starts with `otel-`, the three Perl API, SDK and exporter entries, and `instrumentation-matlab-*` if it is the MATLAB SDK. Print the list.
- Tier: `isNative` or type `application integration` without `isFirstParty` gives `native`; `isFirstParty` gives `first-party`; repo under `github.com/open-telemetry/` or `go.opentelemetry.io/` gives `otel`; else `third-party`.
- Kind: type `application integration` goes to `applications/`; everything else to `libraries/<language>/`.
- Slug: from the key, without the type and language prefixes and without the decorations `compile-time-`, `-native`, `-old`, `-openinference`, `-plugin`, `-otel`, `-instrumentation*`, and the vendor prefixes `uptrace-`, `traceloop-`, `nhatthm-`, `xsam-`, `riandyrn-`, `pragmaticivan-`, `autotelic-`, `kotel-`, `splunk`, `otel`. Entries with the same kind, language and slug become options of one file.
- Skip OTel-owned entries in Java, JavaScript, Python and .NET whose target id exists in `readExplorer()`; print how many were skipped per language.
- Option fields: `repo` from `urls.repo`; `docs` from `urls.docs`; `package` as `<ecosystem>:<name>` with `gems` written as `gem` and `pip` as `pypi`; `note` from `description` (one line) when the repo is a subdirectory or there is no repo; `license` (SPDX-normalised, `Commercial` and `proprietary` become `proprietary`) only when there is no repo or GitHub detects none.
- `name`: `title` without the words "OpenTelemetry", "Instrumentation", "instrumentation for", "auto-instrumentation", "Library", "Plugin" and surrounding punctuation; falls back to the slug.
- The script ends by loading its output with `loadTargets` and asserting no schema errors.

- [ ] **Step 1: Write and run the script** against opentelemetry.io at `origin/main` and a fresh Explorer checkout. Expect about 360 options written and 239 or so skipped as covered.
- [ ] **Step 2: Manual pass.** Review every file with more than one option; fix names that the heuristic mangled; add missing repo URLs to open-source entries; remove same-tier near-duplicates case by case. Record what was removed in the commit message.
- [ ] **Step 3: Run `GITHUB_TOKEN=... npm run data`** and read `report.json`. Fix findings that are conversion mistakes; leave real ones marked.
- [ ] **Step 4: Commit** `data/` and the script.

### Task 7: The page

**Files:**
- Create: `astro.config.mjs`, `src/pages/index.astro`, `src/components/Card.astro`, `src/scripts/search.ts`, `src/styles/registry.scss`
- Test: `tests/search.test.ts` for the pure filter function

**Interfaces:**
- Consumes: `public/registry.json` (`RegistryEntry[]`).
- Produces: `export function matches(entry: { language?: string; kind: string; tiers: string[] }, filters: { language?: string; tier?: string; kind?: string }): boolean` and `export function readParams(search: string): { s?: string; language?: string; tier?: string; kind?: string }` in `src/scripts/search.ts`.

Port from opentelemetry.io, keeping class names so the page reads as a copy: `layouts/_shortcodes/ecosystem/registry/search-form.html`, `layouts/_partials/ecosystem/registry/entry.html`, `assets/js/registrySearch.js`, `assets/scss/_registry.scss`.

- Header in the OpenTelemetry site colours with the title "Registry" and a banner: "Prototype. Not an official OpenTelemetry page. Data may be incomplete."
- Filters: language, tier, type (application or library). Entry count shown as today.
- Card: name, language badge, first option's tier badge, links (repo, docs, package page), licence, maintainer, CNCF badge, description; then "Also:" with each remaining option's label, tier and link.
- Search: MiniSearch over name, description, option labels and maintainer.
- `?s=`, `?language=`, `?tier=`, `?kind=` are read on load and kept in the URL as filters change. `?component=` is ignored.
- A short "Add or fix an entry" section linking to the repo's README.

- [ ] **Step 1: Write failing tests**

```ts
test('readParams ignores component', () => assert.deepEqual(readParams('?language=js&component=instrumentation'), { language: 'js' })); // Review Focus 5
test('readParams reads s', () => assert.equal(readParams('?s=redis').s, 'redis'));
test('matches filters by language, tier and kind', ...);
test('tier filter matches any option of the entry', ...);
```

- [ ] **Step 2: Run**, expect fail. **Step 3: Implement the script, then the page and card.**
- [ ] **Step 4: `npm run build && npx astro preview`**; open the page, check search, each filter, a deep link, and compare side by side with `https://opentelemetry.io/ecosystem/registry/`. Take a screenshot.
- [ ] **Step 5: Commit.**

## Milestone 2: operations

### Task 8: Marks, removal and workflows

**Files:**
- Create: `src/registry/lifecycle.ts`, `.github/workflows/check.yml`, `.github/workflows/scan.yml`, `netlify.toml`, `README.md`
- Test: `tests/lifecycle.test.ts`

**Interfaces:**
- Consumes: `Finding`, `report.json`.
- Produces:

```ts
export type Marks = Record<string, { since: string; check: Check; reason: string }>; // key `${file}#${option}`
export function parseIssue(body: string): Marks;                 // reads the JSON block between <!-- marks --> comments; empty object if absent
export function renderIssue(marks: Marks, today: string): string; // a table for people plus the JSON block
export function updateMarks(prev: Marks, findings: Finding[], today: string): Marks;
export function dueForRemoval(marks: Marks, today: string, days?: number): string[]; // keys, default 30
export function removeOptions(yamlText: string, indexes: number[]): string | null;   // null when no option is left
```

- `updateMarks`: a finding already marked keeps its `since`; a new one gets `today`; a mark with no finding is dropped.
- CLI `node src/registry/lifecycle.ts`: reads `report.json`; if `tokenUsed` is false it exits 0 and changes nothing; otherwise it finds or creates the issue titled "Marked entries", writes the new body, then force-rebuilds branch `removals` from `main` with the due options removed, and opens, updates or closes the pull request "Remove entries marked for 30 days". Uses the `gh` CLI.
- `check.yml`: on `pull_request`, runs `npm test` and `npm run data -- --changed <changed data files>`.
- `scan.yml`: weekly cron plus `workflow_dispatch` (the rescan), runs the build, then the lifecycle CLI, then calls the Netlify build hook if `NETLIFY_BUILD_HOOK` is set. The removal pull request body links to the workflow's "Run workflow" page and says to rescan before merging.
- `netlify.toml`: `command = "npm run build"`, `publish = "dist"`, Node 26.
- `README.md`: prototype notice, what the registry lists, the file format with the two examples from the spec, tiers, checks and what "marked" means, how to run locally.

- [ ] **Step 1: Write failing tests**

```ts
test('new finding is marked today', ...);
test('existing mark keeps its date', ...);
test('cleared finding is unmarked', ...);
test('due after 30 days, not after 29', () => { const m = { 'a.yml#0': { since: '2026-10-28', check: 'repo', reason: '' } } as Marks; assert.deepEqual(dueForRemoval(m, '2026-11-27'), ['a.yml#0']); assert.deepEqual(dueForRemoval(m, '2026-11-26'), []); });
test('renderIssue then parseIssue round-trips', ...);
test('removeOptions drops one of two options and keeps the rest of the file', ...);
test('removeOptions returns null when the last option goes', ...);
```

- [ ] **Step 2: Run**, expect fail. **Step 3: Implement.** **Step 4: Run**, expect pass. Commit.

### Task 9: Publish

- [ ] **Step 1:** Create the public repo `otel-registry` under the owner's account with `gh repo create`, description "Prototype: a leaner OpenTelemetry registry. Not an official OpenTelemetry project.", and push `main`.
- [ ] **Step 2:** Confirm `check.yml` passes on a trivial pull request, and run `scan.yml` by hand once; confirm the "Marked entries" issue appears.
- [ ] **Step 3:** Hand the owner the two Netlify steps: connect the repo, set `GITHUB_TOKEN`; then add the build hook URL as the repo secret `NETLIFY_BUILD_HOOK`.
