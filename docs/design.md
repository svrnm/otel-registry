# OTel Registry prototype: design

Status: draft for approval, 2026-11-27.

## Intent

The registry at `opentelemetry.io/ecosystem/registry/` lives in the website
repo as 1,151 YAML files plus templates, a version-bump bot, link checking and
review load. Issue open-telemetry/opentelemetry.io#11377 froze it and names the
Ecosystem Explorer as its eventual successor, but the Explorer only holds data
generated from `open-telemetry` repos and is not ready to take third-party
listings.

This prototype rebuilds the registry as a small standalone project that:

- leaves the website repo entirely, with no submodule or sync back into it;
- is cheap to keep running, because almost nothing is maintained by hand;
- keeps the part only a registry can provide: listings that are not owned by
  the OpenTelemetry project;
- can later converge with the Ecosystem Explorer, or be dropped, without
  losing the curated data.

It is first published under a personal GitHub account so the docs team can
review it. If it works, it moves to `registry.opentelemetry.io`.

## Goals

1. A standalone repo and static site that is a visual copy of today's registry
   page (search box, filters, cards).
2. Scope is instrumentation only: one entry per instrumented application or
   library.
3. Each entry lists the ways to get telemetry from that target, ordered by
   tier: native, then first-party, then OTel-owned, then third-party. The best
   one is shown first and the others are listed beneath it.
4. A contributor supplies a name, a tier and a link, plus a one-line note
   when the link points into a shared repo. Everything else is inferred when
   the site is built.
5. OTel-owned options come from the Ecosystem Explorer's data at build time
   wherever the Explorer has them.
6. Entries are checked for correctness on every pull request and on a
   schedule. Entries that are wrong, abandoned or dead are marked and hidden,
   and dropped after 30 days if nobody follows up.
7. All current registry entries in scope are converted.

## Non-goals

- Collector components, core packages (API, SDK, semconv), SDK plugins
  (exporters, resource detectors, propagators and similar) and utilities. These
  535 entries are dropped.
- Stored package versions and the version-bump bot.
- Tags, categories, and any filter beyond language, tier and kind.
- A page per entry.
- Localization.
- Any change to opentelemetry.io (removing the registry there, redirects,
  replacing the shortcodes that read registry data). That is separate, later
  work.
- Creating a repo in the `open-telemetry` org, governance, and the
  `registry.opentelemetry.io` domain.
- Entries for unofficial language implementations (Perl, Haskell and others).
  Whether and where these are listed is an open question; they are left out of
  the prototype.

## Anti-goals

- No routine bot commits that a maintainer has to merge. The standing removal
  pull request is the only automated change to the data.
- Nothing durable may depend on the page framework. The page is expected to be
  thrown away if the project converges with the Explorer.
- A network or API failure must never hide or drop an entry.
- The prototype must not pass for an official OpenTelemetry property. It
  carries a visible "Prototype" banner.

## Constraints

- Node, npm and TypeScript. Astro with static output for the page. Netlify for
  hosting. GitHub Actions for checks and schedules.
- Inference uses GitHub's GraphQL API, which needs a read-only token. Without
  a token the build must still succeed: inferred fields are empty and no entry
  is marked. This keeps local builds and fork previews working.
- The Explorer's repo layout is not a published contract. Each ecosystem is
  read through its own small adapter, and a layout change must fail the build
  loudly instead of silently producing fewer entries.
- The repo is public, on a personal account, named `otel-registry`.

## Approaches considered

| Approach | Outcome |
|---|---|
| Move only the data out and mount it back into the website as a submodule | Rejected: the website keeps a sync step and the build coupling |
| Standalone site on Hugo and Docsy, copying today's templates | Rejected: two toolchains, since the data step needs Node anyway |
| React, Vite and Tailwind, matching the Explorer's stack | Rejected: the page cannot be a visual copy and nothing would be reused on convergence |
| One plain Node script that also renders the HTML | Viable, but needs hand-written glue for styles and script bundling |
| **Standalone TypeScript data script that emits one JSON file, plus an Astro page that only renders that JSON** | **Chosen** |

The chosen split puts everything worth keeping (data, tier model, inference
and checks) in the script and its JSON output. The Explorer could consume the
same JSON later, and the page can be deleted.

## Data model

One file per target. The path is the identity; kind and language are read from
it and not stored.

```
libraries/<language>/<target>.yml
applications/<target>.yml
```

```yaml
# libraries/dotnet/aspnetcore.yml
name: ASP.NET Core
options:
  - tier: native
    repo: https://github.com/dotnet/aspnetcore
    docs: https://learn.microsoft.com/aspnet/core/log-mon/metrics/metrics
    note: Emits traces and metrics natively since .NET 8.
```

```yaml
# applications/traefik-proxy.yml
name: Traefik Proxy
options:
  - tier: native
    repo: https://github.com/traefik/traefik
    docs: https://doc.traefik.io/traefik/observability/tracing/opentelemetry/
```

### Hand-written fields

| Field | Level | Required | Meaning |
|---|---|---|---|
| `name` | target | yes | Display name of the instrumented app or library |
| `tier` | option | yes | `native`, `first-party`, `otel` or `third-party` |
| `repo` | option | one of `repo` or `docs` | Source repository of this option |
| `docs` | option | one of `repo` or `docs` | Page explaining how to enable telemetry |
| `package` | option | no | `<ecosystem>:<name>`, for example `npm:@fastify/otel` |
| `license` | option | no | SPDX identifier, or `proprietary`. Only needed when it cannot be detected |
| `note` | option | no | One line shown with the option. Expected when `repo` points into a subdirectory of a shared repo, where the repo's own description says nothing about this option |

File names are lower-case and hyphenated. Unknown fields fail validation.
Every link belongs to an option, so every check applies to one option.

### Tiers

- **native**: the app or library itself emits OpenTelemetry telemetry.
- **first-party**: a plugin or instrumentation library maintained by the
  project that owns the instrumented app or library.
- **otel**: the option lives in the `open-telemetry` GitHub org.
- **third-party**: everything else.

Options are ordered by tier. Within a tier they are ordered alphabetically by
package name, falling back to repo URL. Where several options in one tier are
near-duplicates, the weaker ones are removed by hand, case by case.

### Closed source

Only `applications/` entries may be closed source. They give a `docs` link and
`license: proprietary`. Library options must have a public repo.

### Inferred at build time, never stored

| Fact | Source |
|---|---|
| Licence | GitHub licence detection for the repo |
| Maintainer | Repo owner |
| Description | Repo description, unless a `note` is given |
| Archived, moved or missing repo | GitHub |
| CNCF project and its level | The CNCF landscape file, matched by repo or org |
| OTel tier | Repo is under `open-telemetry` |
| Date added | Git history of the file |

## Build

A standalone script, with no dependency on Astro, does this in order:

1. Load and validate every YAML file against the schema.
2. Fetch the Ecosystem Explorer repo and read the latest release of each
   ecosystem it holds that is in scope: Java agent, JavaScript, Python and
   .NET. Each becomes `otel`-tier options keyed by target.
3. Merge generated and hand-written options into one entry per target.
4. Infer the facts in the table above.
5. Run the checks below.
6. Sort options, then write `registry.json` (what the page renders) and
   `report.json` (check results).

The Explorer repo is read, not its website, because the website's index files
omit the source path, the library link and the instrumented package, and have
no .NET data.

Java needs grouping. The Explorer lists the Java agent per module, and one
library is often split by version range (`spring-webmvc-3.1`,
`spring-webmvc-5.3`, `spring-webmvc-6.0`). Modules are grouped by the
Explorer's `display_name`, which gives about 171 targets from 251 modules.

If the Explorer repo, GitHub or the CNCF landscape cannot be reached, the build
fails and the previous deploy stays live. It never publishes a site with
entries missing because a source was down.

## Checks and lifecycle

Checks are about correctness, not activity. A quiet repo is fine; a dead link
or a fact that is no longer true is not.

| Check | Fails when |
|---|---|
| Schema | The file does not match the schema |
| Duplicate | The target already has an option for the same repo or package |
| Repo | The repo no longer exists |
| Abandoned | The repo is archived |
| Licence | No licence is detected and none is declared |
| Links | `docs` does not resolve |

- **Per option, not per file:** a check fails for one option. That option is
  marked, hidden and later removed; the other options of the target stay. A
  target disappears from the site only when it has no visible option left,
  and its file is deleted only when its last option is removed. The tracking
  issue lists file plus option.
- **On a pull request:** all checks run on the changed files and a failure
  blocks the merge with the reason.
- **Weekly:** all checks run on every hand-written entry. A failing entry is
  marked: it is hidden from the site and listed in one tracking issue with the
  reason and the date it first failed. If the problem is fixed, or goes away,
  the mark clears on the next run.
- **Removal:** one standing pull request always contains exactly the entries
  that have been marked for 30 days or more. It is rebuilt on every weekly
  run, so a fixed entry drops out of it and a newly eligible one is added. If
  nothing is eligible, there is no pull request.
- **Rescan:** a maintainer can start the same run on demand from the removal
  pull request, and does so right before merging. Merging it is the
  maintainer's roughly monthly step; nothing is removed without that merge.
- A repo that moved is not a failure. It is reported so the link can be
  updated.
- Options generated from the Explorer are not checked here.
- When the Explorer starts covering something that also has a hand-written
  `tier: otel` option, the Duplicate check marks the hand-written one. The
  generated option keeps showing, and the removal pull request clears the
  hand-written one. This is how the interim OTel files go away.
- An API or network error is never a failure. Only a definite answer marks an
  entry.

The tracking issue is the only place the "first failed" date is kept, so the
checks add no commits to the repo.

## Site

One page that copies today's registry: a search box, filters, and a card per
target.

- Reuses today's Bootstrap 5 markup and classes, the existing registry styles,
  Font Awesome icons, and the existing client-side search script with
  MiniSearch, adapted to the new JSON.
- Filters: language, tier, and application or library.
- `?s=` and `?language=` work as they do today. `?component=` is ignored so old
  links still land on the page.
- A card shows the target name, language, the first option with its tier
  badge, links, licence, maintainer and CNCF badge, then an "Also" list of the
  remaining options.
- A visible "Prototype" banner, and a short section on how to add an entry.

## Conversion

A one-off script converts the current registry (`data/registry` in
opentelemetry.io at a pinned commit) into the new layout. It is throwaway.

| Group | Entries today | What happens |
|---|---:|---|
| Out-of-scope types | 535 | Dropped |
| Typed as instrumentation but not an instrumented app or library | 14 | Dropped (11 unofficial language SDKs, 3 zero-code agents) |
| OTel-owned, covered by the Explorer | 239 | Not written; generated at build |
| OTel-owned, not in the Explorer yet | about 181 | Written as `tier: otel` files, removed by the Duplicate check as the Explorer catches up |
| Native, first-party and third-party | about 182 | Written as hand-kept files |

Mapping: `isNative` and application integrations become `native`,
`isFirstParty` becomes `first-party`, a repo under `open-telemetry` becomes
`otel`, the rest `third-party`. Title, tags, authors, version, created date,
website, licence and CNCF level are not carried over, because they are
inferred or dropped.

Today's `description` becomes `note` only where `repo` points into a
subdirectory of a shared repo (about 220 options, for example the OTel contrib
repos and `traceloop/openllmetry`). Elsewhere it is dropped and the repo's own
description is used. This has to be settled before the manual pass, because
re-running the script afterwards is expensive.

Manual pass after the script:

- Name each target and merge the 31 targets that have more than one entry.
- Add the repo URL to open-source entries that lack one (18 today).
- Declare the licence where GitHub cannot detect it (10 today).
- Decide case by case on same-tier duplicates.

## Deploy and operations

- A Netlify site on the personal account builds from the repo, with the GitHub
  token as a build variable.
- GitHub Actions run the pull-request checks and the weekly check, which
  updates the tracking issue and rebuilds the standing removal pull request.
  The same run can be started by hand as a rescan. Each run also triggers a
  Netlify rebuild so inferred facts and hidden entries stay current.

## Left to the builder

- Code layout, schema library, and test approach.
- Exact shape of `registry.json` and `report.json`.
- How the Explorer repo is fetched, and how each adapter derives a target name
  that matches hand-written files.
- Link-check timeouts, retries and concurrency.
- Card markup details, as long as the page reads as a copy of today's.

## Open questions

These do not block the prototype.

1. Where unofficial language implementations (Perl, Haskell and others) are
   listed, if anywhere.
2. Licence of the repo and its data. Proposed: Apache-2.0 for code and
   CC-BY-4.0 for data, as in opentelemetry.io.
3. What opentelemetry.io does with `/ecosystem/registry/` and the docs pages
   that read registry data once this replaces it.
4. How and when this converges with the Ecosystem Explorer.

## Decisions made without explicit confirmation

- Checks apply per option: one bad option does not hide a target that still
  has a good one.
- There is no `website` field. Every link belongs to an option.
- Old descriptions are kept as notes only for links into shared repos.
- Checks run weekly, plus on demand as a rescan.
- The tracking issue holds the "first failed" date.
- Explorer data is read from its repo, not its website.
- Java modules are grouped by the Explorer's display name.
- The build fails, keeping the last deploy, when a data source is unreachable.
