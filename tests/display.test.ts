import { test } from 'node:test';
import assert from 'node:assert/strict';
import { githubRepo, heading, normalizeUrl, optionLabel, ownerOf } from '../src/registry/display.ts';

test('githubRepo reads owner and name and tells a repo root from a path inside it', () => {
  assert.deepEqual(githubRepo('https://github.com/nestjs/nest'), { owner: 'nestjs', name: 'nest', root: true });
  assert.deepEqual(githubRepo('https://github.com/nestjs/nest/'), { owner: 'nestjs', name: 'nest', root: true });
  assert.equal(githubRepo('https://github.com/rails/rails/tree/main/actionpack')?.root, false);
  assert.equal(githubRepo('https://pkg.go.dev/net/http'), undefined);
  assert.equal(githubRepo('https://github.com/clickhouse'), undefined);
});

test('normalizeUrl ignores case of host, owner and repo, trailing slashes and .git', () => {
  assert.equal(normalizeUrl('https://GitHub.com/NestJS/Nest.git/'), 'https://github.com/nestjs/nest');
  assert.equal(normalizeUrl('https://github.com/a/b/tree/main/Pkg/'), 'https://github.com/a/b/tree/main/Pkg');
  assert.equal(normalizeUrl('https://pkg.go.dev/net/http/'), 'https://pkg.go.dev/net/http');
});

test('heading is the name, else owner/name of a GitHub repo, else host and path', () => {
  assert.equal(heading({ target: 'https://github.com/nestjs/nest' }), 'nestjs/nest');
  assert.equal(heading({ target: 'https://github.com/nestjs/nest', name: 'NestJS' }), 'NestJS');
  assert.equal(heading({ target: 'https://pkg.go.dev/net/http' }), 'pkg.go.dev/net/http');
});

test('optionLabel prefers the package, then the repo, then the docs host', () => {
  assert.equal(optionLabel({ package: 'npm:@fastify/otel', repo: 'https://github.com/fastify/otel' }), '@fastify/otel');
  assert.equal(optionLabel({ repo: 'https://github.com/Acme/x' }), 'Acme/x');
  assert.equal(optionLabel({ repo: 'https://github.com/Acme/mono/tree/main/packages/y-otel' }), 'Acme/mono/y-otel');
  assert.equal(optionLabel({ docs: 'https://docs.vendor.example/otel' }), 'docs.vendor.example');
  assert.equal(optionLabel({}), 'built in');
});

test('ownerOf reads the GitHub owner', () => {
  assert.equal(ownerOf('https://github.com/Traefik/traefik/tree/x'), 'Traefik');
  assert.equal(ownerOf('https://example.com/a/b'), undefined);
  assert.equal(ownerOf(undefined), undefined);
});
