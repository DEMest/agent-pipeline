import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePipelineSh } from '../src/generate-sh.mjs';

const CFG = {
  version: 1,
  project: { name: 'my-app', stack: 'node-ts', goal: 'g' },
  autonomy: 'prod-gate',
  stage: 'sketch',
  checks: { test: 'npm run test -- --run', lint: 'npm run lint' },
  required: ['test'],
};
const HASH = 'a'.repeat(64);

test('начинается с шебанга и маркера хеша', () => {
  const lines = generatePipelineSh(CFG, HASH).split('\n');
  assert.equal(lines[0], '#!/usr/bin/env sh');
  assert.equal(lines[1], `# generated-from-config: sha256:${HASH}`);
});

test('содержит функцию на каждую проверку с её командой', () => {
  const sh = generatePipelineSh(CFG, HASH);
  assert.match(sh, /^check_test\(\) \{$/m);
  assert.match(sh, /^\s+npm run test -- --run$/m);
  assert.match(sh, /^check_lint\(\) \{$/m);
  assert.match(sh, /^\s+npm run lint$/m);
});

test('включает set -eu, чтобы упавшая команда валила скрипт', () => {
  assert.match(generatePipelineSh(CFG, HASH), /^set -eu$/m);
});

test('диспетчер знает каждую проверку и слово all', () => {
  const sh = generatePipelineSh(CFG, HASH);
  assert.match(sh, /^\s+test\) check_test ;;$/m);
  assert.match(sh, /^\s+lint\) check_lint ;;$/m);
  assert.match(sh, /^\s+all\) check_test; check_lint ;;$/m);
});

test('неизвестный аргумент даёт код возврата 2', () => {
  assert.match(generatePipelineSh(CFG, HASH), /exit 2/);
});

test('не содержит CR', () => {
  assert.equal(generatePipelineSh(CFG, HASH).includes('\r'), false);
});

test('порядок проверок сохраняет порядок ключей конфига', () => {
  const reordered = { ...CFG, checks: { lint: 'npm run lint', test: 'npm run test -- --run' } };
  assert.match(generatePipelineSh(reordered, HASH), /^\s+all\) check_lint; check_test ;;$/m);
});
