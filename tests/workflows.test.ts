import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

const scan: any = load(readFileSync(new URL('../.github/workflows/scan.yml', import.meta.url), 'utf8'));
const steps: any[] = scan.jobs.scan.steps;
const indexOf = (needle: string) => steps.findIndex((s) => JSON.stringify(s).includes(needle));

test('the scan always works from the default branch, whatever branch it is started on', () => {
  const checkout = steps.find((s) => String(s.uses ?? '').startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.event.repository.default_branch }}');
});

test('the site rebuild does not depend on the tracking issue or removal pull request succeeding', () => {
  assert.ok(indexOf('NETLIFY_BUILD_HOOK') > -1 && indexOf('lifecycle.ts') > -1);
  assert.ok(indexOf('NETLIFY_BUILD_HOOK') < indexOf('lifecycle.ts'));
});

test('a manual run can set the removal threshold', () => {
  assert.ok(scan.on.workflow_dispatch.inputs.remove_after_days);
  assert.ok(JSON.stringify(steps[indexOf('lifecycle.ts')]).includes('REMOVE_AFTER_DAYS'));
});
