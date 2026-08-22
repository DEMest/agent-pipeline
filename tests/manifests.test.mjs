import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('манифест плагина содержит имя pipeline и версию', () => {
  const m = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
  assert.equal(m.name, 'pipeline');
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
});

test('marketplace ссылается на этот же репозиторий как источник', () => {
  const m = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].name, 'pipeline');
  assert.equal(m.plugins[0].source, './');
});

test('версии в двух манифестах совпадают', () => {
  const plugin = JSON.parse(readFileSync('.claude-plugin/plugin.json', 'utf8'));
  const market = JSON.parse(readFileSync('.claude-plugin/marketplace.json', 'utf8'));
  assert.equal(plugin.version, market.plugins[0].version);
});

test('каждый скилл, объявленный в репозитории, существует на диске', () => {
  assert.ok(existsSync('skills/pipeline-init/SKILL.md'));
});

test('README объясняет установку и то, что настройкой занимается агент', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /plugin marketplace add/);
  assert.match(readme, /pipeline:init/);
  // Утверждение про агента проверяется отдельно: без него тест проходил бы,
  // даже если бы объяснение «настройкой занимается агент» из README пропало.
  assert.match(readme, /Настройкой занимается агент/);
});

test('README честно перечисляет, что пока не поддерживается', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /Пока не поддерживается/);
  // Названия нереализованных частей: если какую-то из них построят, строку нужно убрать
  // осознанно, а не оставить README обещающим то, чего нет, или отрицающим то, что есть.
  for (const missing of ['python', 'деплой', 'ship']) {
    assert.match(readme, new RegExp(missing, 'i'), `README должен упоминать ${missing} среди границ`);
  }
});
