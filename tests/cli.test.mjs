import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateInto, checkDrift } from '../src/cli.mjs';

const CONFIG_TEXT = `
version: 1
project:
  name: my-app
  stack: node-ts
  goal: "пример"
autonomy: prod-gate
stage: sketch
checks:
  test: npm run test -- --run
required: [test]
`;

function makeProject(configText = CONFIG_TEXT) {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-'));
  mkdirSync(join(dir, '.pipeline'), { recursive: true });
  writeFileSync(join(dir, '.pipeline', 'config.yml'), configText, 'utf8');
  return dir;
}

test('пишет оба артефакта и сообщает пути', () => {
  const dir = makeProject();
  try {
    const { written } = generateInto(dir);
    assert.deepEqual(written.sort(), [
      join(dir, '.github', 'workflows', 'ci.yml'),
      join(dir, 'scripts', 'pipeline.sh'),
    ].sort());
    assert.match(readFileSync(join(dir, 'scripts', 'pipeline.sh'), 'utf8'), /check_test\(\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('оба артефакта несут один и тот же хеш конфига', () => {
  const dir = makeProject();
  try {
    const { hash } = generateInto(dir);
    for (const f of [join(dir, 'scripts', 'pipeline.sh'), join(dir, '.github', 'workflows', 'ci.yml')]) {
      assert.ok(readFileSync(f, 'utf8').includes(`# generated-from-config: sha256:${hash}`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('записанный sh не содержит CR', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    assert.equal(readFileSync(join(dir, 'scripts', 'pipeline.sh'), 'utf8').includes('\r'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('сразу после генерации дрейфа нет', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    assert.deepEqual(checkDrift(dir), { ok: true, stale: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('правка конфига без перегенерации даёт дрейф в обоих артефактах', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    writeFileSync(join(dir, '.pipeline', 'config.yml'), CONFIG_TEXT + '\n# правка\n', 'utf8');
    const result = checkDrift(dir);
    assert.equal(result.ok, false);
    assert.equal(result.stale.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('повторная генерация после правки снимает дрейф', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    writeFileSync(join(dir, '.pipeline', 'config.yml'), CONFIG_TEXT + '\n# правка\n', 'utf8');
    generateInto(dir);
    assert.equal(checkDrift(dir).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('отсутствующий артефакт считается устаревшим, а не падением', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    rmSync(join(dir, 'scripts', 'pipeline.sh'));
    const result = checkDrift(dir);
    assert.equal(result.ok, false);
    assert.ok(result.stale.some((p) => p.endsWith('pipeline.sh')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
