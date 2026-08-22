import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateInto, checkDrift } from '../src/cli.mjs';

const CLI_PATH = join('src', 'cli.mjs');

function runCli(args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], { encoding: 'utf8' });
}

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

test('неподдерживаемый стек не оставляет ни одного записанного файла', () => {
  const dir = makeProject(CONFIG_TEXT.replace('stack: node-ts', 'stack: python'));
  try {
    assert.throws(() => generateInto(dir));
    assert.equal(existsSync(join(dir, 'scripts', 'pipeline.sh')), false);
    assert.equal(existsSync(join(dir, '.github', 'workflows', 'ci.yml')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI на неподдерживаемом стеке печатает сообщение об ошибке без стектрейса Node и код 1', () => {
  const dir = makeProject(CONFIG_TEXT.replace('stack: node-ts', 'stack: python'));
  try {
    const result = runCli(['generate', dir]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.trim(), 'стек python пока не поддерживается генератором CI');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('CLI без каталога проекта печатает подсказку по использованию и завершается ненулевым кодом', () => {
  const result = runCli(['check']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /использование/i);
});

test('CLI совсем без аргументов печатает подсказку и завершается ненулевым кодом', () => {
  const result = runCli([]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /использование/i);
});

test('CLI с неизвестной командой достижимо сообщает об этом с кодом 2', () => {
  const result = runCli(['frobnicate', '.']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /неизвестная команда/);
});
