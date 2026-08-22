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
  assert.match(text, /actions/i);
});

test('скилл требует снимать команды с проекта, а не выдумывать', () => {
  assert.match(SKILL(), /package\.json/);
});

test('скилл завершается зелёным CI, а не записью файлов', () => {
  const text = SKILL();
  assert.match(text, /gh pr checks/);
});

test('команда ссылается на скилл', () => {
  assert.match(readFileSync('commands/pipeline-init.md', 'utf8'), /pipeline-init/);
});
