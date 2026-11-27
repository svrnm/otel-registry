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

An entry is one YAML file. The path is its identity:

```
data/libraries/<language>/<target>.yml
data/applications/<target>.yml
```

```yaml
# data/libraries/dotnet/aspnetcore.yml
name: ASP.NET Core
options:
  - tier: native
    repo: https://github.com/dotnet/aspnetcore
    docs: https://learn.microsoft.com/aspnet/core/log-mon/metrics/metrics
```

```yaml
# data/applications/traefik-proxy.yml
name: Traefik Proxy
options:
  - tier: native
    repo: https://github.com/traefik/traefik
    docs: https://doc.traefik.io/traefik/observability/tracing/opentelemetry/
```

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | The instrumented app or library, not the instrumentation |
| `tier` | yes | `native`, `first-party`, `otel` or `third-party` |
| `repo` | `repo` or `docs` | Source repository of this option |
| `docs` | `repo` or `docs` | Page explaining how to enable telemetry |
| `package` | no | `<ecosystem>:<name>`, for example `npm:@fastify/otel` |
| `license` | no | SPDX identifier, only when it cannot be detected from the repository |
| `note` | no | One line. Expected when `repo` points into a subdirectory of a shared repository |

Everything else is read when the site is built and never stored: licence,
maintainer and description from the repository, CNCF status from the
[CNCF landscape](https://github.com/cncf/landscape).

Rules:

- File names are lower-case, with digits, hyphens and dots.
- A library option needs a public repository.
- Only `applications/` entries may be closed source. They give a `docs` link
  and `license: proprietary`.
- Instrumentation in the `open-telemetry` org is not added here. It comes from
  the [Ecosystem Explorer](https://explorer.opentelemetry.io) when the site is
  built. The `tier: otel` files in this repo are placeholders for languages the
  Explorer does not cover yet.

## Checks, and what "marked" means

Checks are about correctness, not activity. An option fails when:

| Check | Fails when |
|---|---|
| `repo` | The repository no longer exists |
| `abandoned` | The repository is archived |
| `licence` | No licence is detected and none is declared |
| `links` | The `docs` link, or a link into a repository subdirectory, does not resolve |
| `duplicate` | The target already has an option for the same repository or package |

- **Pull requests:** a failing option in a changed file blocks the merge.
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

- `data/`: the hand-written entries.
- `src/registry/`: plain TypeScript with no dependency on the page. It loads
  the entries, reads the Ecosystem Explorer's data, infers facts, runs the
  checks and writes `public/registry.json` and `report.json`.
- `src/pages/`, `src/components/`: one Astro page that renders
  `registry.json`. It is a visual copy of today's registry and is meant to be
  replaceable.
- `.github/workflows/`: the pull-request check and the weekly scan.
- `scripts/convert.ts`: the one-off conversion from opentelemetry.io's
  `data/registry`. Kept for reference.

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
