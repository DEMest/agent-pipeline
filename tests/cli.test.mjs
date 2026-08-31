import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateInto, checkDrift, diagnose, upgrade, inspectStage } from '../src/cli.mjs';

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

test('CLI на неверном конфиге печатает сообщение об ошибке без стектрейса Node и код 1', () => {
  const dir = makeProject(CONFIG_TEXT.replace('stack: node-ts', 'stack: rust'));
  try {
    const result = runCli(['generate', dir]);
    assert.equal(result.status, 1);
    // Именно сообщение целиком, а не подстрока: стектрейс Node тоже содержал бы
    // текст ошибки, и проверка на вхождение прошла бы при худшем выводе.
    assert.match(result.stderr.trim(), /^project.stack: ожидалось одно из /);
    assert.equal(result.stderr.includes('at '), false, 'в выводе не должно быть стектрейса');
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

test('диагноз связывает шаг с командой из конфига проекта', () => {
  const dir = makeProject();
  try {
    const logPath = join(dir, 'failed.log');
    writeFileSync(logPath, [
      'checks\ttest\t2026-08-22T11:40:14.2012345Z ℹ fail 1',
      'checks\ttest\t2026-08-22T11:40:14.9998765Z ##[error]Process completed with exit code 1.',
    ].join('\n'), 'utf8');
    const text = diagnose(dir, logPath);
    assert.match(text, /checks/);
    assert.match(text, /npm run test -- --run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('диагноз выдаётся и без конфига проекта', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-nocfg-'));
  try {
    const logPath = join(dir, 'failed.log');
    writeFileSync(logPath, 'checks\ttest\t2026-08-22T11:40:14.9998765Z ##[error]Process completed with exit code 1.\n', 'utf8');
    const text = diagnose(dir, logPath);
    assert.match(text, /checks/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('диагноз по несуществующему файлу лога сообщает об этом внятно', () => {
  const dir = makeProject();
  try {
    assert.throws(() => diagnose(dir, join(dir, 'нет-такого.log')), /лог/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CONFIG_WITH_DEPLOY = `
version: 1
project:
  name: my-app
  stack: node-ts
  goal: "пример"
autonomy: prod-gate
stage: product
checks:
  test: npm run test -- --run
required: [test]
deploy:
  target: docker-vps
  registry: ghcr.io/owner/my-app
  environments:
    production: { host: deploy@example.com, url: "https://example.com", auto: false }
  healthcheck: { path: /healthz, timeout_sec: 30 }
  secrets: [SSH_KEY, REGISTRY_TOKEN]
`;

test('с секцией deploy пишется третий артефакт', () => {
  const dir = makeProject(CONFIG_WITH_DEPLOY);
  try {
    const { written } = generateInto(dir);
    assert.ok(written.some((p) => p.endsWith('deploy.yml')), `deploy.yml не записан: ${written.join(', ')}`);
    assert.equal(checkDrift(dir).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('без секции deploy workflow выкатки не создаётся', () => {
  const dir = makeProject();
  try {
    const { written } = generateInto(dir);
    assert.equal(written.some((p) => p.endsWith('deploy.yml')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('правка конфига без перегенерации делает устаревшим и workflow выкатки', () => {
  const dir = makeProject(CONFIG_WITH_DEPLOY);
  try {
    generateInto(dir);
    writeFileSync(join(dir, '.pipeline', 'config.yml'), `${CONFIG_WITH_DEPLOY}\n# правка\n`, 'utf8');
    const { ok, stale } = checkDrift(dir);
    assert.equal(ok, false);
    assert.ok(stale.some((p) => p.endsWith('deploy.yml')), `deploy.yml не отмечен устаревшим: ${stale.join(', ')}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('оставшийся deploy.yml замечается, даже если секцию deploy убрали из конфига', () => {
  // Иначе забытый workflow продолжил бы выкатывать прод по правилам,
  // которых в конфиге больше нет.
  const dir = makeProject(CONFIG_WITH_DEPLOY);
  try {
    generateInto(dir);
    writeFileSync(join(dir, '.pipeline', 'config.yml'), CONFIG_TEXT, 'utf8');
    const { ok, stale } = checkDrift(dir);
    assert.equal(ok, false);
    assert.ok(stale.some((p) => p.endsWith('deploy.yml')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrade помечает артефакты версией инструмента', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    const sh = readFileSync(join(dir, 'scripts', 'pipeline.sh'), 'utf8');
    assert.match(sh, /^# generated-by: agent-pipeline \d+\.\d+\.\d+$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrade на свежих артефактах ничего не меняет', () => {
  // Идемпотентность важна: иначе каждая проверка обновления создавала бы
  // изменение в git и человек не отличил бы настоящее обновление от шума.
  const dir = makeProject();
  try {
    generateInto(dir);
    const { changed, unchanged } = upgrade(dir);
    assert.deepEqual(changed, []);
    assert.ok(unchanged.length > 0, 'артефакты должны попасть в список неизменившихся');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrade замечает артефакт, собранный другой версией', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    const shPath = join(dir, 'scripts', 'pipeline.sh');
    const aged = readFileSync(shPath, 'utf8').replace(/# generated-by: agent-pipeline .*/, '# generated-by: agent-pipeline 0.0.1');
    writeFileSync(shPath, aged, 'utf8');
    const { changed, toVersion } = upgrade(dir);
    assert.equal(changed.length, 1, `ожидался один изменённый артефакт, получено ${changed.length}`);
    assert.equal(changed[0].from, '0.0.1');
    assert.notEqual(toVersion, '0.0.1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('upgrade сообщает, что версии не было, для артефактов старого формата', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    const shPath = join(dir, 'scripts', 'pipeline.sh');
    const legacy = readFileSync(shPath, 'utf8').split('\n').filter((l) => !l.startsWith('# generated-by:')).join('\n');
    writeFileSync(shPath, legacy, 'utf8');
    const { changed } = upgrade(dir);
    assert.equal(changed[0].from, null, 'у артефакта без пометки версии from должен быть null');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('state сообщает стадию из конфига и стадию по метрикам', () => {
  const dir = makeProject();
  try {
    const result = inspectStage(dir);
    assert.equal(result.current, 'sketch');
    assert.ok(['sketch', 'shaping', 'product', 'sustained'].includes(result.suggested));
    assert.ok(Number.isInteger(result.metrics.sourceFiles));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('state не переписывает снимок, когда вывод не изменился', () => {
  // Метрики меняются с каждым коммитом. Запись на каждый прогон превратила бы
  // историю проекта в поток диффов, среди которых настоящий переход незаметен.
  const dir = makeProject();
  try {
    const first = inspectStage(dir);
    assert.equal(first.written, true, 'первый прогон должен создать снимок');
    const second = inspectStage(dir);
    assert.equal(second.written, false, 'повторный прогон не должен трогать файл');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('state работает в каталоге без git, а не падает', () => {
  // Проект может быть ещё не под контролем версий — метрики истории просто нулевые.
  const dir = makeProject();
  try {
    const result = inspectStage(dir);
    assert.equal(result.metrics.commits, 0);
    assert.equal(result.metrics.contributors, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('испорченный снимок не мешает работе', () => {
  const dir = makeProject();
  try {
    writeFileSync(join(dir, '.pipeline', 'state.json'), '{ это не json', 'utf8');
    const result = inspectStage(dir);
    assert.ok(result.suggested, 'стадия должна вычислиться, несмотря на испорченный снимок');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
