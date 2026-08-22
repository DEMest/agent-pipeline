import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCi, UnsupportedStackError } from '../src/generate-ci.mjs';
import { parse as parseYaml } from 'yaml';

const CFG = {
  version: 1,
  project: { name: 'my-app', stack: 'node-ts', goal: 'g' },
  autonomy: 'prod-gate',
  stage: 'sketch',
  checks: { test: 'npm run test -- --run', lint: 'npm run lint' },
  required: ['test'],
};
const HASH = 'b'.repeat(64);

test('первая строка — маркер хеша', () => {
  assert.equal(generateCi(CFG, HASH).split('\n')[0], `# generated-from-config: sha256:${HASH}`);
});

test('результат — валидный YAML с двумя джобами', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['checks', 'drift-check']);
});

test('запускается на pull_request и на push в main', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  assert.ok(Object.hasOwn(doc.on, 'pull_request'));
  assert.deepEqual(doc.on.push.branches, ['main']);
});

test('drift-check сверяет хеш конфига без парсинга YAML', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  const script = doc.jobs['drift-check'].steps.map((s) => s.run ?? '').join('\n');
  assert.match(script, /sha256sum \.pipeline\/config\.yml/);
  assert.match(script, /generated-from-config/);
});

test('обязательная проверка не помечена continue-on-error', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  const step = doc.jobs.checks.steps.find((s) => s.name === 'test');
  assert.equal(step.run, 'sh scripts/pipeline.sh test');
  assert.equal(step['continue-on-error'], undefined);
});

test('необязательная проверка помечена continue-on-error', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  const step = doc.jobs.checks.steps.find((s) => s.name === 'lint');
  assert.equal(step['continue-on-error'], true);
});

test('для node-ts ставит Node и выполняет npm ci', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  const uses = doc.jobs.checks.steps.map((s) => s.uses).filter(Boolean);
  assert.ok(uses.some((u) => u.startsWith('actions/setup-node@')));
  assert.ok(doc.jobs.checks.steps.some((s) => s.run === 'npm ci'));
});

test('нереализованный стек отвергается явной ошибкой', () => {
  const cfg = { ...CFG, project: { ...CFG.project, stack: 'go' } };
  assert.throws(() => generateCi(cfg, HASH), (e) => e instanceof UnsupportedStackError && e.stackName === 'go');
});
