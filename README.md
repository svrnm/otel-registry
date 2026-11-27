# OTel Registry (prototype)

> [!WARNING]
> This is a prototype. It is not an official OpenTelemetry project, and its data
> may be incomplete. The official registry is at
> <https://opentelemetry.io/ecosystem/registry/>.

A leaner take on the OpenTelemetry registry. It lists **applications and
libraries you can get OpenTelemetry telemetry from**, one entry per instrumented
thing. Where there are several ways to instrument something, they are ordered:

1. **native**: the app or library emits OpenTelemetry telemetry itself.
2. **first-party**: a plugin or instrumentation library maintained by the
   project that owns the app or library.
3. **otel**: instrumentation in the `open-telemetry` GitHub org.
4. **third-party**: everything else.

The background and the decisions are in [docs/design.md](docs/design.md).

## Add or fix an entry

An entry is one YAML file. It says **what is instrumented** and the ways to get
telemetry from it:

```yaml
# data/libraries/js/nestjs.yml
target: https://github.com/nestjs/nest
options:
  - tier: third-party
    repo: https://github.com/pragmaticivan/nestjs-otel
```

```yaml
# data/applications/kubernetes.yml
target: https://github.com/kubernetes/kubernetes
options:
  - tier: native
    docs: https://kubernetes.io/docs/concepts/cluster-administration/system-traces/
```

`target` is the most specific stable link to the instrumented thing: its own
repository when it has one, otherwise its package, docs or product page
(`https://pkg.go.dev/net/http`). **The target is the identity.** Every file and
every Ecosystem Explorer item with the same target and language ends up on one
card, so before adding a file, search the site for the library: if it has a
card, use the same `target`.

The folder says what kind of thing it is: `data/applications/`, or
`data/libraries/<language>/`. The file name is yours to choose.

| Field | Where | Required | Meaning |
|---|---|---|---|
| `target` | file | yes | Link to what is instrumented |
| `name` | file | only when `target` is not a GitHub repository | What to call it, for example `net/http` |
| `tier` | option | yes | `native`, `first-party`, `otel` or `third-party` |
| `repo` | option | `repo` or `docs`, except for `native` | Source repository of this option |
| `docs` | option | `repo` or `docs`, except for `native` | Page explaining how to enable telemetry |
| `package` | option | no | `<ecosystem>:<name>`, for example `npm:@fastify/otel` |
| `license` | option | no | SPDX identifier, only when it cannot be detected from the repository |

There are no titles or descriptions. A card is headed by its target
(`nestjs/nest`), and licence and CNCF status are read when the site is built.

Rules:

- A `native` option needs no `repo`: native support lives in the target.
- A library option needs a public repository.
- Only `applications/` entries may be closed source. Their options give a
  `docs` link and `license: proprietary`.
- `tier: otel` is only for repositories in the `open-telemetry` org. Most of
  those are not written here at all: they come from the
  [Ecosystem Explorer](https://explorer.opentelemetry.io) when the site is
  built.

### Which target an Explorer item belongs to

The Explorer lists OpenTelemetry-maintained instrumentation by package. For
Java it also says what each one instruments. For everything else,
[`data/explorer.yml`](data/explorer.yml) does:

```yaml
javascript/instrumentation-nestjs-core: https://github.com/nestjs/nest
```

An Explorer item that is not listed there still shows, under its own
repository. The build prints how many there are.

## Checks, and what "marked" means

Checks are about correctness, not activity. An option fails when:

| Check | Fails when |
|---|---|
| `repo` | The repository no longer exists |
| `abandoned` | The repository is archived |
| `licence` | No licence is detected and none is declared |
| `links` | The `docs` link, or a link into a repository subdirectory, does not resolve |
| `duplicate` | The target already has an option for the same repository or package, in this or another file |

- **Pull requests:** a newly failing option in a changed file blocks the merge.
  Options the tracking issue already lists do not.
- **Weekly scan:** a failing option is *marked*. It is hidden from the site and
  listed in the issue "Marked entries" with the reason and the date.
- **Follow up:** fix the entry, or the cause, and the mark clears on the next
  scan.
- **Removal:** one standing pull request holds the options that have been
  marked for 30 days. A maintainer rescans (run the *Scan* workflow by hand)
  and merges it.
- A network or API error never marks anything.

A check applies to one option. A target stays visible as long as it has one
option left.

## Run it locally

Needs Node 26.

```sh
npm install
npm test
GITHUB_TOKEN=$(gh auth token) npm run build   # builds data, then the site into dist/
npx astro preview
```

Without `GITHUB_TOKEN` the build still works, but nothing is inferred and
nothing is checked.

## How it is put together

- `data/`: the hand-written entries, and `explorer.yml`.
- `src/registry/`: plain TypeScript with no dependency on the page. It loads
  the entries, reads the Ecosystem Explorer's data, infers facts, runs the
  checks and writes `public/registry.json` and `report.json`.
- `src/pages/`, `src/components/`: one Astro page that renders
  `registry.json`. It is a visual copy of today's registry and is meant to be
  replaceable.
- `.github/workflows/`: the pull-request check and the weekly scan.
The entries were converted from the registry data in
[open-telemetry/opentelemetry.io](https://github.com/open-telemetry/opentelemetry.io/tree/main/data/registry).

## Licence

Not decided yet, which is why there is no `LICENSE` file. The proposal is
Apache-2.0 for the code and CC-BY-4.0 for the data, as in opentelemetry.io.

## Deploying

The site is static and builds on Netlify with `npm run build`.

- Set `GITHUB_TOKEN` (read-only access to public repositories) in the Netlify
  site's environment variables.
- Add the Netlify build hook URL as the repository secret
  `NETLIFY_BUILD_HOOK`, so each scan refreshes the site.
- In the repository's Actions settings, allow GitHub Actions to create pull
  requests. The scan needs it for the removal pull request.
