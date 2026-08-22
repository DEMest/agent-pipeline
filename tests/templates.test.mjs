import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseConfig } from '../src/config.mjs';

test('заготовка конфига после подстановки значений валидна', () => {
  const tmpl = readFileSync('templates/common/config.yml.tmpl', 'utf8');
  const filled = tmpl
    .replaceAll('{{NAME}}', 'my-app')
    .replaceAll('{{STACK}}', 'node-ts')
    .replaceAll('{{GOAL}}', 'тестовая цель')
    .replaceAll('{{AUTONOMY}}', 'prod-gate')
    .replaceAll('{{STAGE}}', 'sketch');
  const cfg = parseConfig(filled);
  assert.equal(cfg.project.name, 'my-app');
  assert.equal(cfg.stage, 'sketch');
});

test('заготовка объясняет, что файл ведёт агент', () => {
  const tmpl = readFileSync('templates/common/config.yml.tmpl', 'utf8');
  assert.match(tmpl, /pipeline:reconfigure/);
});

test('пресет node-ts содержит команды проверок и список обязательных', () => {
  const preset = JSON.parse(readFileSync('templates/stacks/node-ts/preset.json', 'utf8'));
  assert.ok(Object.hasOwn(preset.checks, 'test'));
  assert.ok(Object.hasOwn(preset.checks, 'build'));
  assert.ok(Array.isArray(preset.required));
  for (const name of preset.required) {
    assert.ok(Object.hasOwn(preset.checks, name), `required ссылается на ${name}, которого нет в checks`);
  }
});

test('smoke-тест шаблона не зависит от кода проекта', () => {
  const smoke = readFileSync('templates/stacks/node-ts/smoke.test.mjs', 'utf8');
  assert.match(smoke, /node:test/);
  assert.equal(smoke.includes('../src/'), false);
});

test('настройки шаблона объявляют SessionStart-хук', () => {
  const settings = JSON.parse(readFileSync('templates/common/claude-settings.json', 'utf8'));
  const entries = settings.hooks.SessionStart;
  assert.ok(Array.isArray(entries) && entries.length > 0);
  assert.match(JSON.stringify(entries), /pipeline-status\.sh/);
});

test('SessionStart-хук только печатает: ни сети, ни записи, ни установки', () => {
  const hook = readFileSync('templates/common/hooks/pipeline-status.sh', 'utf8');
  for (const forbidden of ['curl', 'wget', 'npm install', 'pip install', 'git ', '>', 'rm ']) {
    assert.equal(hook.includes(forbidden), false, `хук не должен содержать ${JSON.stringify(forbidden)}`);
  }
  assert.match(hook, /echo/);
});
