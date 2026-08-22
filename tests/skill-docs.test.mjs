import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SKILL = () => readFileSync('skills/pipeline-init/SKILL.md', 'utf8');

test('у скилла есть frontmatter с name и description', () => {
  const text = SKILL();
  assert.match(text, /^---\n/);
  assert.match(text, /^name: pipeline-init$/m);
  assert.match(text, /^description: .+$/m);
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

test('скилл завершается зелёным CI, а не записью файлов', () => {
  const text = SKILL();
  assert.match(text, /gh pr checks/);
});

test('команда ссылается на скилл', () => {
  assert.match(readFileSync('commands/init.md', 'utf8'), /pipeline-init/);
});
