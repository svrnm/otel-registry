// One-off, throwaway: converts opentelemetry.io's data/registry into this repo's data/ layout.
//   GITHUB_TOKEN=... node scripts/convert.ts <opentelemetry.io>/data/registry <explorer>/ecosystem-registry data
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dump, load } from 'js-yaml';
import { readExplorer, slug } from '../src/registry/explorer.ts';
import { fetchFacts, isSubdirectory, repoKey } from '../src/registry/facts.ts';
import { loadTargets } from '../src/registry/targets.ts';
import type { HandOption, Tier } from '../src/registry/targets.ts';

const [srcDir, explorerDir, outDir] = process.argv.slice(2);

// Typed as instrumentation, but not an instrumented app or library.
const MISFITS = new Set([
  // unofficial language SDKs
  'otel-crystal', 'otel-dart', 'otel-haskell', 'otel-julia', 'otel-lua', 'otel-matlab', 'otel-ocaml',
  'otel-perl-api', 'otel-perl-sdk', 'exporter-perl-otlp', 'otel-scala', 'sdk-swift-nautilustelemetry',
  // zero-code agents
  'otel-go-autoinstrumentation', 'otel-java-instrumentation', 'otel-php-autoinstrumentation',
]);

// Open-source entries that list no repo today.
const REPOS: Record<string, string> = {
  'application-integration-collector-cloud-foundry': 'https://github.com/cloudfoundry/cf-deployment',
  'application-integration-go-istio': 'https://github.com/istio/istio',
  'application-integration-go-knative': 'https://github.com/knative/eventing',
  'application-integration-go-kubernetes': 'https://github.com/kubernetes/kubernetes',
  'application-integration-go-kuma': 'https://github.com/kumahq/kuma',
  'application-integration-go-kyverno': 'https://github.com/kyverno/kyverno',
  'application-integration-go-open-policy-agent': 'https://github.com/open-policy-agent/opa',
  'application-integration-go-openfeature flagd': 'https://github.com/open-feature/flagd',
  'application-integration-go-thanos': 'https://github.com/thanos-io/thanos',
  'application-integration-java-microcks': 'https://github.com/microcks/microcks',
  'application-integration-java-strimzi': 'https://github.com/strimzi/strimzi-kafka-operator',
  'application-integration-lua-kong-api-gateway': 'https://github.com/Kong/kong',
  'application-integration-payara': 'https://github.com/payara/Payara',
  'application-integration-rust-go-kubewarden': 'https://github.com/kubewarden/kubewarden-controller',
  'instrumentation-go-gorm': 'https://github.com/go-gorm/opentelemetry',
  'instrumentation-java-elasticsearch-client': 'https://github.com/elastic/elasticsearch-java',
  'instrumentation-java-quarkus': 'https://github.com/quarkusio/quarkus',
};

const LICENSES: Record<string, string> = {
  'apache 2.0': 'Apache-2.0', 'apache-2.0': 'Apache-2.0', mit: 'MIT', commercial: 'proprietary', proprietary: 'proprietary',
  'apache 2.0 or mit': 'Apache-2.0 OR MIT', 'apache-2.0 or mit': 'Apache-2.0 OR MIT', 'gnu lesser general public license v2.1': 'LGPL-2.1',
  'reciprocal public license 1.5': 'RPL-1.5', 'mlpv2.0': 'MPL-2.0', 'cc0 1.0': 'CC0-1.0',
};
const ECOSYSTEMS: Record<string, string> = { gems: 'gem', pip: 'pypi' };

// Manual pass, kept here so the conversion can be re-run: targets that are the same thing under two slugs.
const SLUGS: Record<string, string> = {
  "go/chi-chi": "chi", "go/sql": "database-sql", "go/grpc-metrics": "grpc", "go/segmentio-go-kafka": "kafka-go", "go/mongo": "mongodb",
  "go/http": "net-http", "go/kafka": "confluent-kafka-go",
  "python/genaianthropic": "anthropic", "python/genailangchain": "langchain", "python/genaiopenai": "openai",
  "python/genaiopenaiagents": "openai-agents", "python/genaiweaviateclient": "weaviate", "python/genaiclaudeagentsdk": "claude-agent-sdk",
  "python/googlegenai": "google-genai", "python/mistral": "mistralai",
};

// Manual pass: names the title heuristic got wrong. The name is the instrumented thing, not the instrumentation.
const NAMES: Record<string, string> = {
  "applications/checkmk": "Checkmk", "applications/clickhouse": "ClickHouse", "applications/docker-buildx": "Docker Buildx",
  "applications/kubernetes": "Kubernetes", "applications/matlab": "MATLAB", "applications/thousandeyes": "ThousandEyes",
  "applications/roadrunner": "RoadRunner",
  "libraries/android/httpurlconnection": "HttpURLConnection", "libraries/android/okhttp3": "OkHttp", "libraries/android/okhttp3websocket": "OkHttp WebSocket",
  "libraries/cpp/boostlog": "Boost.Log", "libraries/cpp/glog": "glog", "libraries/cpp/grpc": "gRPC", "libraries/cpp/httpd": "Apache httpd",
  "libraries/cpp/log4cxx": "Apache Log4cxx", "libraries/cpp/nginx": "NGINX", "libraries/cpp/spdlog": "spdlog",
  "libraries/dotnet/elasticsearchclient": "Elasticsearch Client", "libraries/dotnet/fusioncache": "FusionCache", "libraries/dotnet/httpclient": "HttpClient",
  "libraries/dotnet/masstransit": "MassTransit",
  "libraries/erlang/bandit": "Bandit", "libraries/erlang/broadway": "Broadway", "libraries/erlang/commanded": "Commanded", "libraries/erlang/dataloader": "Dataloader",
  "libraries/erlang/finch": "Finch", "libraries/erlang/grpc": "gRPC", "libraries/erlang/httpoison": "HTTPoison", "libraries/erlang/nebulex": "Nebulex",
  "libraries/erlang/req": "Req", "libraries/erlang/xandra": "Xandra",
  "libraries/go/anthropic": "anthropic-sdk-go", "libraries/go/chi": "chi", "libraries/go/client-go": "client-go", "libraries/go/cloudwego": "CloudWeGo Hertz",
  "libraries/go/database-sql": "database/sql", "libraries/go/franz-go": "franz-go", "libraries/go/gin": "Gin", "libraries/go/graphql": "graphql-go",
  "libraries/go/grpc": "gRPC", "libraries/go/net-http": "net/http", "libraries/go/confluent-kafka-go": "confluent-kafka-go", "libraries/go/kafka-go": "segmentio/kafka-go",
  "libraries/go/log": "log", "libraries/go/logrus": "Logrus", "libraries/go/mongodb": "MongoDB Go Driver", "libraries/go/mysql": "go-sql-driver/mysql",
  "libraries/go/neo4j": "Neo4j Go Driver", "libraries/go/openai-go": "openai-go", "libraries/go/pgx": "pgx", "libraries/go/pq": "lib/pq",
  "libraries/go/restful": "go-restful", "libraries/go/resty": "Resty", "libraries/go/slog": "log/slog", "libraries/go/sqlx": "sqlx", "libraries/go/sqs": "Amazon SQS",
  "libraries/java/annotations": "OpenTelemetry Annotations", "libraries/java/grpc": "gRPC",
  "libraries/js/angular": "Angular", "libraries/js/cerbos": "Cerbos", "libraries/js/langchain": "LangChain", "libraries/js/openai": "OpenAI", "libraries/js/prisma": "Prisma",
  "libraries/python/bedrock": "Amazon Bedrock", "libraries/python/dspy": "DSPy", "libraries/python/grpc": "gRPC", "libraries/python/mistralai": "Mistral AI",
  "libraries/python/traceverde": "TraceVerde", "libraries/python/anthropic": "Anthropic", "libraries/python/langchain": "LangChain", "libraries/python/openai": "OpenAI",
  "libraries/python/openai-agents": "OpenAI Agents", "libraries/python/weaviate": "Weaviate", "libraries/python/claude-agent-sdk": "Claude Agent SDK",
  "libraries/python/google-genai": "Google GenAI SDK",
};

const tail = (url: string) => url.replace(/\/+$/, '').split('/').pop()!;
const oneLine = (s: string | undefined) => (s ? s.trim().replace(/\s+/g, ' ') : undefined);
const githubRepoRoot = (url: string | undefined) => (url && /^https:\/\/github\.com\/[^/]+\/[^/#?]+\/?$/.test(url) ? url.replace(/\/$/, '') : undefined);

function targetSlug(key: string, language: string): string {
  let k = key.replace(/^(instrumentation|application-integration)-/, '').replace(new RegExp(`^${language}-`), '');
  k = k
    .replace(/^compile-time-/, '')
    .replace(/-(native|old|openinference|plugin|otel|traceway|instrumentation.*)$/, '')
    .replace(/^(uptrace|traceloop|nhatthm|xsam|riandyrn|pragmaticivan|autotelic|kotel)-/, '')
    .replace(/^(splunk|otel)(?=[a-z])/, '')
    .replace(/^go-(?=[a-z])/, '');
  return slug(k) || slug(key);
}

function displayName(title: string, fallback: string): string {
  const name = title
    .replace(/\b(OpenTelemetry|Open Telemetry|OTel)\b/gi, '')
    .replace(/\b(auto-?instrumentation|instrumentation library|instrumentation|integration|library|plugin|package)\b/gi, '')
    .replace(/\b(for|of|the|with)\b\s*$/i, '')
    .replace(/^\s*\b(for|of|the)\b/i, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–:,.]+|[\s\-–:,.]+$/g, '')
    .replace(/^(for|of)\s+/i, '');
  return name.length >= 2 ? name : fallback;
}

interface Row { key: string; e: any; kind: 'library' | 'application'; language: string; tier: Tier; repo?: string; docs?: string }

const rows: Row[] = [];
const dropped: string[] = [];
for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.yml'))) {
  const key = file.replace(/\.yml$/, '');
  const e: any = load(readFileSync(join(srcDir, file), 'utf8'));
  if (!['instrumentation', 'application integration'].includes(e.registryType)) continue;
  if (MISFITS.has(key)) { dropped.push(key); continue; }

  let repo: string | undefined = e.urls?.repo ?? REPOS[key] ?? githubRepoRoot(e.urls?.website) ?? githubRepoRoot(e.urls?.docs);
  const goContrib = /^https:\/\/(?:pkg\.go\.dev\/)?go\.opentelemetry\.io\/contrib\/(.+)$/.exec(repo ?? '');
  if (goContrib) repo = `https://github.com/open-telemetry/opentelemetry-go-contrib/tree/main/${goContrib[1]}`;
  let docs: string | undefined = e.urls?.docs;
  if (docs?.startsWith('/')) docs = `https://opentelemetry.io${docs}`;
  if (docs && repo && docs.replace(/\/$/, '') === repo.replace(/\/$/, '')) docs = undefined;

  const app = e.registryType === 'application integration';
  const otel = /github\.com\/open-telemetry\//i.test(repo ?? '');
  const tier: Tier = app ? (e.isFirstParty ? 'first-party' : 'native') : e.isNative ? 'native' : e.isFirstParty ? 'first-party' : otel ? 'otel' : 'third-party';
  rows.push({ key, e, kind: app ? 'application' : 'library', language: e.language, tier, repo, docs });
}

// OTel-owned entries the Explorer already covers are generated at build time, not written.
const generated = readExplorer(explorerDir);
function covered(r: Row): boolean {
  if (r.tier !== 'otel' || !r.repo) return false;
  const pkg: string | undefined = r.e.package?.name;
  const javaPath = (u: string) => u.split('/instrumentation/')[1];
  return generated.some((g) => {
    if (g.language !== r.language) return false;
    const gPkg = g.option.package?.replace(/^[a-z]+:/, '');
    if (pkg && gPkg && pkg.toLowerCase() === gPkg.toLowerCase()) return true;
    const a = tail(r.repo!).toLowerCase();
    const b = tail(g.option.repo).toLowerCase();
    if (a === b || a === gPkg?.toLowerCase() || a.replace(/^opentelemetry-/, '') === b) return true;
    if (r.language === 'java') {
      const p = javaPath(r.repo!);
      const q = javaPath(g.option.repo);
      return !!p && !!q && (p === q || q.startsWith(`${p}/`) || p.startsWith(`${q}/`) || p.split('/')[0] === q.split('/')[0]);
    }
    return false;
  });
}
const skipped: Record<string, number> = {};
const kept = rows.filter((r) => {
  if (!covered(r)) return true;
  skipped[r.language] = (skipped[r.language] ?? 0) + 1;
  return false;
});

const keys = [...new Set(kept.map((r) => repoKey(r.repo)).filter((k): k is string => !!k))];
const facts = await fetchFacts(keys, process.env.GITHUB_TOKEN || undefined);

const TIER_ORDER: Tier[] = ['native', 'first-party', 'otel', 'third-party'];
const files = new Map<string, { rows: Row[]; options: HandOption[] }>();
const needsAttention: string[] = [];
for (const r of kept.sort((a, b) => TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier) || a.key.localeCompare(b.key))) {
  const computed = targetSlug(r.key, r.language);
  const target = (r.kind === "library" && SLUGS[`${r.language}/${computed}`]) || computed;
  const path = r.kind === 'application' ? `applications/${target}.yml` : `libraries/${r.language}/${target}.yml`;
  const stored = LICENSES[String(r.e.license ?? '').toLowerCase()] ?? r.e.license;
  const fact = facts.get(repoKey(r.repo) ?? '');
  const undetected = fact && fact !== 'unknown' && fact.exists && !fact.license;
  const pkg = r.e.package?.name && r.e.package?.registry ? `${ECOSYSTEMS[r.e.package.registry] ?? r.e.package.registry}:${r.e.package.name}` : undefined;

  if (!r.repo && r.kind === 'library') { needsAttention.push(`${r.key}: library without a repo, not written`); continue; }
  if (!r.repo && stored !== 'proprietary') needsAttention.push(`${r.key}: no repo and licence "${r.e.license}", written as proprietary`);

  const option: HandOption = {
    tier: r.tier,
    ...(r.repo ? { repo: r.repo } : {}),
    ...(r.docs ? { docs: r.docs } : !r.repo ? { docs: r.e.urls?.website } : {}),
    ...(pkg && /^[a-z]+:\S+$/.test(pkg) ? { package: pkg } : {}),
    ...(!r.repo ? { license: 'proprietary' } : undetected && stored ? { license: stored } : {}),
    ...((!r.repo || isSubdirectory(r.repo)) && oneLine(r.e.description) ? { note: oneLine(r.e.description) } : {}),
  };
  const f = files.get(path) ?? { rows: [], options: [] };
  f.rows.push(r);
  f.options.push(option);
  files.set(path, f);
}

rmSync(join(outDir, 'libraries'), { recursive: true, force: true });
rmSync(join(outDir, 'applications'), { recursive: true, force: true });
for (const [path, f] of files) {
  const first = f.rows[0]; // highest tier
  const fallback = tail(path).replace(/\.yml$/, '');
  const name = NAMES[path.replace(/\.yml$/, '')] ?? (first.kind === 'application' ? oneLine(first.e.title)! : displayName(first.e.title ?? '', fallback));
  mkdirSync(dirname(join(outDir, path)), { recursive: true });
  writeFileSync(join(outDir, path), dump({ name, options: f.options }, { lineWidth: -1, quotingType: '"' }));
}

const written = loadTargets(outDir); // throws on any schema error
const options = written.reduce((n, t) => n + t.options.length, 0);
const byTier: Record<string, number> = {};
for (const t of written) for (const o of t.options) byTier[o.tier] = (byTier[o.tier] ?? 0) + 1;
console.log(`in scope: ${rows.length + dropped.length} | dropped as misfits: ${dropped.length} | covered by the Explorer (skipped): ${JSON.stringify(skipped)}`);
console.log(`written: ${written.length} files, ${options} options ${JSON.stringify(byTier)} | token used: ${!!process.env.GITHUB_TOKEN}`);
console.log(`files with more than one option: ${written.filter((t) => t.options.length > 1).length}`);
for (const line of needsAttention) console.log(`ATTENTION ${line}`);
