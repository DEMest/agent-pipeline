import test from 'node:test';
import assert from 'node:assert/strict';
import { readText } from './read-text.mjs';

// Достаёт содержимое frontmatter-блока в самом начале файла (между первой парой строк
// «---»). Проверка description именно внутри этого блока, а не где угодно в тексте, —
// иначе строка `description: ...` в теле документа (например, в примере команды) тоже
// засчиталась бы как валидный frontmatter.
function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, 'файл должен начинаться с frontmatter-блока (--- ... ---)');
  return match[1];
}

const SKILL = () => readText('skills/pipeline-init/SKILL.md');

test('у скилла есть frontmatter с name и description', () => {
  const text = SKILL();
  assert.match(text, /^---\n/);
  const fm = frontmatter(text);
  assert.match(fm, /^name: pipeline-init$/m);
  assert.match(fm, /^description: .+$/m);
});

test('скилл требует три проверки окружения из спецификации', () => {
  const text = SKILL();
  assert.match(text, /gh auth status/);
  assert.match(text, /author\.login/);
  assert.match(text, /gh api repos\/<owner>\/<repo>\/actions\/permissions --jq '\.enabled'/);
});

test('скилл требует снимать команды с проекта, а не выдумывать', () => {
  assert.match(SKILL(), /package\.json/);
});

test('скилл ставит зависимость плагина перед вызовом генератора, а не полагается на её наличие', () => {
  const text = SKILL();
  assert.match(text, /npm install --omit=dev --prefix "\$\{CLAUDE_PLUGIN_ROOT\}"/);
  // объяснение обязательно: почему установка вообще нужна и почему разово
  assert.match(text, /клонирова/i);
  assert.match(text, /node_modules/);
});

test('скилл использует переменную CLAUDE_PLUGIN_ROOT вместо плейсхолдера <plugin>', () => {
  const text = SKILL();
  assert.equal(text.includes('<plugin>'), false, 'плейсхолдер <plugin> не должен оставаться в тексте скилла');
  assert.match(text, /\$\{CLAUDE_PLUGIN_ROOT\}\/src\/cli\.mjs/);
});

test('скилл не затирает существующий .claude/settings.json проекта, а дописывает его', () => {
  const text = SKILL();
  // Основной сценарий из README — существующий проект, где .claude/settings.json может
  // быть со своими хуками и правами. Слепое копирование шаблона поверх него их бы стёрло.
  assert.match(text, /если.{0,40}(файл|settings\.json).{0,60}(нет|отсутствует)/is);
  assert.match(text, /(если|когда).{0,60}(файл|settings\.json).{0,60}(есть|существует|уже)/is);
  assert.match(text, /SessionStart/);
  assert.match(text, /показать человеку/i);
});

test('скилл завершается зелёным CI, а не записью файлов', () => {
  const text = SKILL();
  assert.match(text, /gh pr checks/);
});

test('команда ссылается на скилл', () => {
  assert.match(readText('commands/init.md'), /pipeline-init/);
});

const DOCTOR = () => readText('skills/pipeline-ci-doctor/SKILL.md');

test('у скилла ci-doctor есть frontmatter с именем и описанием', () => {
  const text = DOCTOR();
  assert.match(text, /^---\n/);
  const fm = frontmatter(text);
  assert.match(fm, /^name: pipeline-ci-doctor$/m);
  assert.match(fm, /^description: .+$/m);
});

test('ci-doctor получает диагноз командой diagnose, а не читает сырой лог глазами', () => {
  assert.match(DOCTOR(), /cli\.mjs diagnose/);
});

test('ci-doctor ограничивает число попыток тремя', () => {
  const text = DOCTOR();
  assert.match(text, /три попытки|3 попытки/i);
  assert.match(text, /gh pr comment/, 'счётчик попыток должен фиксироваться комментарием к PR');
});

test('ci-doctor проверяет счётчик попыток раньше, чем получает диагноз', () => {
  const text = DOCTOR();
  // Дефект из ревью: указание прочитать прошлые попытки стояло в шаге 4 — после того как
  // агент уже успевал продиагностировать и запушить исправление. Проверка счётчика должна
  // стоять раньше по тексту, чем команда получения диагноза, иначе документ не остановит
  // четвёртую попытку вовремя.
  const counterCheckIndex = text.search(/Выгрузить тела всех комментариев к PR/);
  const diagnoseIndex = text.search(/cli\.mjs diagnose/);
  assert.notEqual(counterCheckIndex, -1, 'в скилле должно быть указание читать комментарии к PR для подсчёта попыток');
  assert.notEqual(diagnoseIndex, -1, 'в скилле должна быть команда получения диагноза');
  assert.ok(
    counterCheckIndex < diagnoseIndex,
    'проверка счётчика попыток должна стоять в тексте раньше получения диагноза'
  );
});

test('ci-doctor различает поломку кода и поломку самого пайплайна', () => {
  assert.match(DOCTOR(), /drift-check/);
});

test('команда fix-ci ссылается на скилл ci-doctor', () => {
  assert.match(readText('commands/fix-ci.md'), /pipeline-ci-doctor/);
});

const SHIP = () => readText('skills/pipeline-ship/SKILL.md');

test('у скилла ship есть frontmatter с именем и описанием', () => {
  const text = SHIP();
  assert.match(text, /^---\n/);
  const fm = frontmatter(text);
  assert.match(fm, /^name: pipeline-ship$/m);
  assert.match(fm, /^description: .+$/m);
});

test('ship прогоняет локальные проверки до пуша, а не полагается на CI', () => {
  assert.match(SHIP(), /pipeline\.sh/);
});

test('ship разбирает все три режима автономности', () => {
  const text = SHIP();
  for (const mode of ['full', 'merge-gate', 'prod-gate']) {
    assert.match(text, new RegExp(`\`${mode}\``), `режим ${mode} должен быть описан`);
  }
});

test('ship честно говорит, что деплой ещё не реализован', () => {
  assert.match(SHIP(), /деплой (пока )?не (реализован|настроен)/i);
});

test('ship передаёт красный CI скиллу ci-doctor, а не чинит сам', () => {
  assert.match(SHIP(), /pipeline-ci-doctor/);
});

test('ship не мерджит, пока проверки не зелёные', () => {
  assert.match(SHIP(), /gh pr checks/);
});

test('команда ship ссылается на скилл', () => {
  assert.match(readText('commands/ship.md'), /pipeline-ship/);
});
