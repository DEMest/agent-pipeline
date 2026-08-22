import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { readText } from './read-text.mjs';

test('манифест плагина содержит имя pipeline и версию', () => {
  const m = JSON.parse(readText('.claude-plugin/plugin.json'));
  assert.equal(m.name, 'pipeline');
  assert.match(m.version, /^\d+\.\d+\.\d+$/);
});

test('marketplace ссылается на этот же репозиторий как источник', () => {
  const m = JSON.parse(readText('.claude-plugin/marketplace.json'));
  assert.equal(m.plugins.length, 1);
  assert.equal(m.plugins[0].name, 'pipeline');
  assert.equal(m.plugins[0].source, './');
});

test('версии в двух манифестах совпадают', () => {
  const plugin = JSON.parse(readText('.claude-plugin/plugin.json'));
  const market = JSON.parse(readText('.claude-plugin/marketplace.json'));
  assert.equal(plugin.version, market.plugins[0].version);
});

test('каждый скилл, объявленный в репозитории, существует на диске', () => {
  assert.ok(existsSync('skills/pipeline-init/SKILL.md'));
});

test('README объясняет установку и то, что настройкой занимается агент, а не человек', () => {
  const readme = readText('README.md');
  assert.match(readme, /plugin marketplace add/);
  assert.match(readme, /pipeline:init/);
  // Утверждение про агента проверяется отдельно: без него тест проходил бы,
  // даже если бы объяснение из README пропало. README написан по-английски.
  assert.match(readme, /The agent does the setup, not you/);
});

test('README ссылается на слэш-команду, реально выводимую из каталога commands/', () => {
  // Имя слэш-команды Claude Code выводит из имени файла: commands/<file>.md в плагине
  // <name> даёт /<name>:<file>. Здесь это имя вычисляется из фактического содержимого
  // каталога commands/ и манифеста плагина, а не переписывается как ожидание руками —
  // иначе тест верен при любой реальности файла, что и было дефектом раньше.
  const pluginName = JSON.parse(readText('.claude-plugin/plugin.json')).name;
  const commandFiles = readdirSync('commands').filter((f) => f.endsWith('.md'));
  const initFile = commandFiles.find((f) => f.replace(/\.md$/, '') === 'init');
  assert.ok(
    initFile,
    `в commands/ должен быть файл init.md, дающий команду /${pluginName}:init; найдены: ${commandFiles.join(', ')}`,
  );
  const commandName = `/${pluginName}:${initFile.replace(/\.md$/, '')}`;
  const readme = readText('README.md');
  assert.ok(readme.includes(commandName), `README должен содержать ${commandName}`);
});

test('README честно перечисляет, что пока не поддерживается', () => {
  const readme = readText('README.md');
  const startIndex = readme.indexOf('Current limits');
  assert.notEqual(startIndex, -1, 'в README должен быть раздел Current limits');
  const nextHeading = readme.indexOf('\n## ', startIndex);
  const section = nextHeading === -1 ? readme.slice(startIndex) : readme.slice(startIndex, nextHeading);
  // Названия нереализованных частей ищем именно внутри раздела Current limits,
  // до следующего заголовка того же уровня, а не по всему файлу целиком. Слово может остаться
  // в README, просто переехав в раздел «Работает» — тогда README лжёт (называет нереализованным
  // то, что на самом деле уже работает, или наоборот), а поиск по всему файлу этого не заметит,
  // потому что слово всё ещё где-то есть.
  for (const missing of ['python', 'maturity stages']) {
    assert.match(section, new RegExp(missing, 'i'), `README должен упоминать ${missing} среди границ`);
  }
});
