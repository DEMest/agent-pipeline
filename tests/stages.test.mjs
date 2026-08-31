import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestStage, isHigher, STAGE_ORDER, THRESHOLDS } from '../src/stages.mjs';

const base = {
  sourceFiles: 3,
  loc: 100,
  directDeps: 1,
  commits: 5,
  contributors: 1,
  ageDays: 2,
  hasProductionEnv: false,
  painSignals: [],
};

test('маленький новый проект остаётся наброском', () => {
  assert.equal(suggestStage(base).stage, 'sketch');
});

test('любого из сигналов размера хватает, чтобы выйти из наброска', () => {
  // Пороги связаны через ИЛИ: проект из трёх файлов с сорока зависимостями
  // так же перерос набросок, как проект из двадцати файлов без зависимостей.
  for (const [field, threshold] of Object.entries(THRESHOLDS.shaping)) {
    const metrics = { ...base, [field]: threshold };
    assert.equal(suggestStage(metrics).stage, 'shaping', `сигнал ${field} не сработал`);
  }
});

test('порог срабатывает на границе, а не после неё', () => {
  const atThreshold = { ...base, sourceFiles: THRESHOLDS.shaping.sourceFiles };
  const belowThreshold = { ...base, sourceFiles: THRESHOLDS.shaping.sourceFiles - 1 };
  assert.equal(suggestStage(atThreshold).stage, 'shaping');
  assert.equal(suggestStage(belowThreshold).stage, 'sketch');
});

test('настроенный прод сразу поднимает до product, минуя счётчики', () => {
  // Появились пользователи — размер кода перестаёт быть главным аргументом.
  const metrics = { ...base, hasProductionEnv: true };
  assert.equal(suggestStage(metrics).stage, 'product');
});

test('давно живущий проект с несколькими авторами доходит до sustained', () => {
  const metrics = { ...base, contributors: 2, ageDays: 200 };
  assert.equal(suggestStage(metrics).stage, 'sustained');
});

test('сигнал боли поднимает стадию, даже когда счётчики молчат', () => {
  // «Проверок не хватило» — довод сильнее любого счётчика строк.
  const metrics = { ...base, painSignals: ['откат прода 2026-08-30'] };
  const result = suggestStage(metrics);
  assert.equal(result.stage, 'shaping');
  assert.ok(result.reasons.some((r) => r.includes('сигнал боли')));
});

test('сигнал боли не поднимает выше последней стадии', () => {
  const metrics = { ...base, contributors: 5, ageDays: 400, painSignals: ['откат прода'] };
  assert.equal(suggestStage(metrics).stage, 'sustained');
});

test('основания перехода перечисляются, а не подразумеваются', () => {
  // Человек должен видеть, почему инструмент считает проект выросшим,
  // иначе предложение ужесточить проверки выглядит произволом.
  const metrics = { ...base, sourceFiles: 100, loc: 9000 };
  const { reasons } = suggestStage(metrics);
  assert.ok(reasons.length > 0);
  assert.ok(reasons.every((r) => /\d/.test(r)), 'в каждом основании должно быть число');
});

test('сравнение стадий уважает порядок строгости', () => {
  assert.equal(isHigher('product', 'sketch'), true);
  assert.equal(isHigher('sketch', 'product'), false);
  assert.equal(isHigher('product', 'product'), false);
  assert.deepEqual(STAGE_ORDER, ['sketch', 'shaping', 'product', 'sustained']);
});
