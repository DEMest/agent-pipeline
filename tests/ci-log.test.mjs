import test from 'node:test';
import assert from 'node:assert/strict';
import { readText } from './read-text.mjs';
import { parseFailedLog, describeFailures } from '../src/ci-log.mjs';

const DRIFT = () => readText('tests/fixtures/failed-drift-check.log');
const CHECKS = () => readText('tests/fixtures/failed-check-test.log');

const CONFIG = {
  version: 1,
  project: { name: 'agent-pipeline', stack: 'node-ts', goal: 'g' },
  autonomy: 'merge-gate',
  stage: 'shaping',
  checks: { test: 'npm test' },
  required: ['test'],
};

test('находит упавшую джобу и шаг', () => {
  const [failure] = parseFailedLog(DRIFT());
  assert.equal(failure.job, 'drift-check');
  assert.equal(failure.step, 'Сверить артефакты с конфигом');
});

test('собирает сообщения об ошибках без повторов', () => {
  const [failure] = parseFailedLog(DRIFT());
  assert.ok(failure.errors.some((e) => e.includes('артефакт не соответствует')));
  const drift = failure.errors.filter((e) => e.includes('артефакт не соответствует'));
  assert.equal(drift.length, 1, 'одинаковые сообщения об ошибке должны схлопываться');
});

test('выбрасывает временные метки из содержимого', () => {
  const [failure] = parseFailedLog(DRIFT());
  for (const line of [...failure.errors, ...failure.excerpt]) {
    assert.equal(/^\d{4}-\d{2}-\d{2}T/.test(line), false, `метка осталась в строке: ${line}`);
  }
});

test('выбрасывает ANSI-последовательности', () => {
  const [failure] = parseFailedLog(CHECKS());
  const joined = [...failure.errors, ...failure.excerpt].join('\n');
  assert.equal(joined.includes(''), false);
});

test('не тащит в выдержку эхо команды из группы', () => {
  const [failure] = parseFailedLog(CHECKS());
  const joined = failure.excerpt.join('\n');
  assert.equal(joined.includes('shell: /usr/bin/bash'), false);
  assert.equal(joined.includes('##[group]'), false);
});

test('оставляет в выдержке настоящий вывод упавшей команды', () => {
  const [failure] = parseFailedLog(CHECKS());
  const joined = failure.excerpt.join('\n');
  assert.match(joined, /AssertionError/);
  assert.match(joined, /fail 1/);
});

test('несколько упавших джоб дают несколько записей', () => {
  // Явный перевод строки между фикстурами: без него последняя строка первой
  // склеилась бы с первой строкой второй, и тест проверял бы не то, что заявляет.
  const combined = `${DRIFT()}\n${CHECKS()}`;
  const failures = parseFailedLog(combined);
  assert.equal(failures.length, 2);
  assert.deepEqual(failures.map((f) => f.job).sort(), ['checks', 'drift-check']);
});

test('пустой лог даёт пустой список, а не исключение', () => {
  assert.deepEqual(parseFailedLog(''), []);
});

test('диагноз связывает шаг с командой проверки из конфига', () => {
  const text = describeFailures(parseFailedLog(CHECKS()), CONFIG);
  assert.match(text, /checks/);
  assert.match(text, /npm test/, 'диагноз должен показать команду, которой запускается упавшая проверка');
});

test('диагноз обходится без конфига', () => {
  const text = describeFailures(parseFailedLog(DRIFT()), null);
  assert.match(text, /drift-check/);
  assert.match(text, /артефакт не соответствует/);
});

test('диагноз по пустому списку говорит, что упавших джоб нет', () => {
  assert.match(describeFailures([], CONFIG), /нет упавших/i);
});
