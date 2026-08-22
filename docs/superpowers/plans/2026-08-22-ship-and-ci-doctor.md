# Цикл ship и диагностика упавшего CI — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Довести задачу от промпта до смерджённого PR одной командой, а упавший CI диагностировать по существу, а не пересказом сырого лога.

**Architecture:** Диагностика разделена надвое. Детерминированная часть — разбор вывода `gh run view --log-failed` — живёт в коде и покрыта тестами на настоящих логах этого репозитория: она вычленяет упавшую джобу, шаг, сообщения об ошибках и сопоставляет шаг с проверкой из `.pipeline/config.yml`. Часть, требующая суждения — что именно чинить — живёт в скиллах `pipeline-ci-doctor` и `pipeline-ship`, которые опираются на готовый диагноз вместо чтения сотен строк лога.

**Tech Stack:** Node 24 (ESM, встроенный `node:test`), `gh` CLI, GitHub Actions.

## Global Constraints

- Единственная runtime-зависимость проекта — `yaml`. Новых npm-пакетов не добавлять.
- Тесты только на `node:test` и `node:assert/strict`. Тест-фреймворки не добавлять.
- ESM, файлы `.mjs`. Команда тестов: `npm test` (это `node --test tests/*.test.mjs`).
- Чтение текстовых файлов репозитория в тестах — через `readText` из `tests/read-text.mjs`, а не через `readFileSync`: на Windows checkout отдаёт CRLF, и сырое чтение делает тесты зависимыми от настроек git у клонирующего.
- Имя слэш-команды выводится из имени файла: `commands/<имя>.md` в плагине `pipeline` даёт `/pipeline:<имя>`. Файл `commands/ship.md` → `/pipeline:ship`.
- Тексты, комментарии и сообщения об ошибках на русском языке. В `description` скилла допустима английская вводная «Use when...» — это принятая конвенция.
- Коммит-сообщения на русском в формате `<type>: <описание>`, полностью на русском без английских слов, без подписи соавтора.
- Лимит попыток починки CI — 3. Счётчик наблюдаемый: каждая попытка фиксируется комментарием к PR через `gh pr comment`, поэтому переживает перезапуск сессии и виден человеку.
- Деплой в этой версии не реализован. Режим `autonomy: prod-gate` мерджит PR и сообщает, что деплой не настроен, вместо того чтобы делать вид, что выкатил.
- Файлы `.pipeline/conventions.md` и `.pipeline/state.json` из спецификации появятся в плане взросления проекта. Скиллы этого плана читают их, если файлы есть, и работают без них, если нет.

## Каждый тест обязан быть способен упасть

В этом проекте уже отгружались три теста, которые не могли покраснеть: `String.match` без флага `/g` для подсчёта вхождений, белый список с шаблоном `\S+`, пропускавшим подстановку команд, и проверка `/actions/i`, совпадавшая с произвольной прозой.

Для каждого нового теста убедитесь фактически: сломайте проверяемое поведение, покажите красный вывод, верните обратно, покажите зелёный. Для тестов, проверяющих содержимое документов, избегайте шаблонов, совпадающих с любым текстом.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `src/ci-log.mjs` | разбор вывода `gh run view --log-failed` в структуру и человекочитаемый диагноз |
| `tests/ci-log.test.mjs` | тесты разбора на настоящих логах |
| `tests/fixtures/failed-drift-check.log` | настоящий лог упавшей джобы `drift-check` из этого репозитория |
| `tests/fixtures/failed-check-test.log` | лог упавшей проверки `test` в джобе `checks` |
| `src/cli.mjs` | добавляется команда `diagnose` |
| `skills/pipeline-ci-doctor/SKILL.md` | инструкция: от красной джобы до исправленного PR |
| `skills/pipeline-ship/SKILL.md` | инструкция: от промпта до смерджённого PR |
| `commands/fix-ci.md` | слэш-команда `/pipeline:fix-ci` |
| `commands/ship.md` | слэш-команда `/pipeline:ship` |
| `tests/skill-docs.test.mjs` | дополняется проверками двух новых скиллов |

Разбор лога вынесен в отдельный модуль, а не в `cli.mjs`, потому что меняется по своей причине — при изменении формата вывода `gh` — и тестируется без обращения к файловой системе.

---

### Task 1: Разбор лога упавшего прогона

**Files:**
- Create: `src/ci-log.mjs`
- Create: `tests/ci-log.test.mjs`
- Create: `tests/fixtures/failed-drift-check.log`
- Create: `tests/fixtures/failed-check-test.log`

**Interfaces:**
- Consumes: тип `Config` из `src/config.mjs` — `{ checks: Record<string,string>, required: string[], ... }`
- Produces:
  - `parseFailedLog(logText: string) -> Failure[]`, где `Failure` — `{ job: string, step: string, errors: string[], excerpt: string[] }`;
  - `describeFailures(failures: Failure[], config: Config|null) -> string` — компактный диагноз на русском.

Формат вывода `gh run view --log-failed`: каждая строка — `<джоба>\t<шаг>\t<временная метка> <содержимое>`. В содержимом встречаются BOM в первой строке, ANSI-последовательности вида `\u001b[36;1m`, маркеры `##[group]` / `##[endgroup]` / `##[error]`. Строки между `##[group]` и `##[endgroup]` — эхо самой команды, а не её вывод.

- [ ] **Step 1: Положить настоящую фикстуру**

Файл `tests/fixtures/failed-drift-check.log` уже снят с настоящего упавшего прогона этого репозитория. Скопируйте его:

```bash
mkdir -p tests/fixtures
cp "C:/Users/1678~1/AppData/Local/Temp/claude/D--Project-Agent-Pipeline/7d6e4522-f7e6-4c59-96e6-a895726cf33c/scratchpad/failed-drift-check.log" tests/fixtures/failed-drift-check.log
```

Проверьте, что файл содержит 16 строк и в нём есть строка с `##[error]артефакт не соответствует`:

```bash
wc -l < tests/fixtures/failed-drift-check.log
grep -c "##\[error\]" tests/fixtures/failed-drift-check.log
```

Ожидается: `16` и `3`.

Если файла по указанному пути нет, снимите свежий лог упавшего прогона:

```bash
gh run list --limit 20 --json databaseId,conclusion --jq '[.[] | select(.conclusion=="failure")][0].databaseId'
gh run view <id> --log-failed > tests/fixtures/failed-drift-check.log
```

- [ ] **Step 2: Создать вторую фикстуру — упавшая проверка**

`tests/fixtures/failed-check-test.log` — тот же формат, случай падения проверки `test` внутри джобы `checks`. Разделители между тремя полями — символы табуляции:

```
checks	test	2026-08-22T11:40:12.1234567Z ##[group]Run sh scripts/pipeline.sh test
checks	test	2026-08-22T11:40:12.1234890Z [36;1msh scripts/pipeline.sh test[0m
checks	test	2026-08-22T11:40:12.1235102Z shell: /usr/bin/bash -e {0}
checks	test	2026-08-22T11:40:12.1235400Z ##[endgroup]
checks	test	2026-08-22T11:40:13.5551234Z > agent-pipeline@0.1.0 test
checks	test	2026-08-22T11:40:13.5559876Z > node --test tests/*.test.mjs
checks	test	2026-08-22T11:40:14.2001234Z ✖ хеш стабилен и имеет длину 64 (1.2003ms)
checks	test	2026-08-22T11:40:14.2005678Z   AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
checks	test	2026-08-22T11:40:14.2009012Z   + actual - expected
checks	test	2026-08-22T11:40:14.2012345Z ℹ fail 1
checks	test	2026-08-22T11:40:14.9998765Z ##[error]Process completed with exit code 1.
```

Символы `[36;1m` и `[0m` в строке 2 должны быть настоящими ANSI-последовательностями с байтом `\u001b` перед `[`. Проще всего записать файл скриптом:

```bash
node -e "
const fs=require('fs');
const E='\u001b';
const lines=[
  'checks\ttest\t2026-08-22T11:40:12.1234567Z ##[group]Run sh scripts/pipeline.sh test',
  'checks\ttest\t2026-08-22T11:40:12.1234890Z '+E+'[36;1msh scripts/pipeline.sh test'+E+'[0m',
  'checks\ttest\t2026-08-22T11:40:12.1235102Z shell: /usr/bin/bash -e {0}',
  'checks\ttest\t2026-08-22T11:40:12.1235400Z ##[endgroup]',
  'checks\ttest\t2026-08-22T11:40:13.5551234Z > agent-pipeline@0.1.0 test',
  'checks\ttest\t2026-08-22T11:40:13.5559876Z > node --test tests/*.test.mjs',
  'checks\ttest\t2026-08-22T11:40:14.2001234Z ✖ хеш стабилен и имеет длину 64 (1.2003ms)',
  'checks\ttest\t2026-08-22T11:40:14.2005678Z   AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:',
  'checks\ttest\t2026-08-22T11:40:14.2009012Z   + actual - expected',
  'checks\ttest\t2026-08-22T11:40:14.2012345Z ℹ fail 1',
  'checks\ttest\t2026-08-22T11:40:14.9998765Z ##[error]Process completed with exit code 1.',
];
fs.writeFileSync('tests/fixtures/failed-check-test.log', lines.join('\n')+'\n');
"
```

- [ ] **Step 3: Написать падающий тест**

`tests/ci-log.test.mjs`:

```js
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
  assert.equal(joined.includes('\u001b'), false);
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
```

- [ ] **Step 4: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/ci-log.mjs'`.

- [ ] **Step 5: Реализовать разбор**

`src/ci-log.mjs`:

```js
// Формат вывода `gh run view --log-failed`: <джоба>\t<шаг>\t<метка времени> <содержимое>.
// В содержимом встречаются BOM, ANSI-последовательности и маркеры GitHub Actions.
const ANSI = /\u001b\[[0-9;]*m/g;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/;
const ERROR_MARKER = '##[error]';
const EXCERPT_LIMIT = 20;

function cleanContent(raw) {
  return raw.replace(/^\uFEFF/, '').replace(ANSI, '').replace(TIMESTAMP, '');
}

export function parseFailedLog(logText) {
  const byJobStep = new Map();

  for (const rawLine of logText.split('\n')) {
    if (rawLine.trim() === '') continue;
    const parts = rawLine.split('\t');
    if (parts.length < 3) continue;

    const job = parts[0].replace(/^\uFEFF/, '').trim();
    const step = parts[1].trim();
    const content = cleanContent(parts.slice(2).join('\t'));
    const key = `${job}\u0000${step}`;

    if (!byJobStep.has(key)) {
      byJobStep.set(key, { job, step, errors: [], excerpt: [], inGroup: false });
    }
    const failure = byJobStep.get(key);

    // Строки между ##[group] и ##[endgroup] — эхо самой команды, а не её вывод.
    if (content.startsWith('##[group]')) {
      failure.inGroup = true;
      continue;
    }
    if (content.startsWith('##[endgroup]')) {
      failure.inGroup = false;
      continue;
    }
    if (content.startsWith(ERROR_MARKER)) {
      const message = content.slice(ERROR_MARKER.length).trim();
      // GitHub повторяет одно и то же сообщение об ошибке, повторы только мешают.
      if (!failure.errors.includes(message)) failure.errors.push(message);
      continue;
    }
    if (failure.inGroup) continue;
    if (content.trim() === '') continue;
    failure.excerpt.push(content);
  }

  return [...byJobStep.values()].map(({ job, step, errors, excerpt }) => ({
    job,
    step,
    errors,
    excerpt: excerpt.slice(-EXCERPT_LIMIT),
  }));
}

export function describeFailures(failures, config) {
  if (failures.length === 0) return 'Упавших джоб в логе нет.';

  const blocks = failures.map((failure) => {
    const lines = [`Джоба «${failure.job}», шаг «${failure.step}».`];

    const command = config?.checks?.[failure.step];
    if (command) {
      lines.push(`Это проверка «${failure.step}» из .pipeline/config.yml, команда: ${command}`);
      const isRequired = config.required?.includes(failure.step);
      lines.push(isRequired
        ? 'Проверка обязательная — без неё PR не проходит.'
        : 'Проверка необязательная: она помечена continue-on-error и джобу не валит.');
    }

    if (failure.errors.length > 0) {
      lines.push('Ошибки:');
      lines.push(...failure.errors.map((e) => `  ${e}`));
    }
    if (failure.excerpt.length > 0) {
      lines.push('Последние строки вывода:');
      lines.push(...failure.excerpt.map((e) => `  ${e}`));
    }
    return lines.join('\n');
  });

  return blocks.join('\n\n');
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, новых тестов 11.

- [ ] **Step 7: Доказать, что тесты способны падать**

Временно замените в `src/ci-log.mjs` строку `if (failure.inGroup) continue;` на `if (false) continue;` и запустите:

Run: `node --test tests/ci-log.test.mjs`
Expected: FAIL — тест «не тащит в выдержку эхо команды из группы» краснеет.

Верните строку обратно, повторите — все проходят. Приведите оба вывода в отчёте.

- [ ] **Step 8: Коммит**

```bash
git add src/ci-log.mjs tests/ci-log.test.mjs tests/fixtures
git commit -m "feat: разбор лога упавшего прогона CI"
```

---

### Task 2: Команда `diagnose` в CLI

**Files:**
- Modify: `src/cli.mjs`
- Modify: `tests/cli.test.mjs`

**Interfaces:**
- Consumes: `parseFailedLog`, `describeFailures` (Task 1); `loadConfig` из `src/config.mjs`
- Produces:
  - `diagnose(projectDir: string, logPath: string) -> string` — текст диагноза;
  - запуск `node src/cli.mjs diagnose <projectDir> <logPath>`, печатающий диагноз.

Конфиг проекта используется, если он читается; если `.pipeline/config.yml` отсутствует или невалиден, диагноз всё равно выдаётся — без привязки шага к команде. Диагностика не должна отказывать из-за того, что сломан конфиг: именно поломанный конфиг мог уронить CI.

- [ ] **Step 1: Написать падающий тест**

В `tests/cli.test.mjs` допишите `diagnose` в уже существующий импорт из `../src/cli.mjs`
(там сейчас `import { generateInto, checkDrift } from '../src/cli.mjs';` — второй импорт из
того же модуля работает, но разводит одну зависимость по двум строкам), затем добавьте тесты:

```js
test('диагноз связывает шаг с командой из конфига проекта', () => {
  const dir = makeProject();
  try {
    const logPath = join(dir, 'failed.log');
    writeFileSync(logPath, [
      'checks\ttest\t2026-08-22T11:40:14.2012345Z ℹ fail 1',
      'checks\ttest\t2026-08-22T11:40:14.9998765Z ##[error]Process completed with exit code 1.',
    ].join('\n'), 'utf8');
    const text = diagnose(dir, logPath);
    assert.match(text, /checks/);
    assert.match(text, /npm run test -- --run/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('диагноз выдаётся и без конфига проекта', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-nocfg-'));
  try {
    const logPath = join(dir, 'failed.log');
    writeFileSync(logPath, 'checks\ttest\t2026-08-22T11:40:14.9998765Z ##[error]Process completed with exit code 1.\n', 'utf8');
    const text = diagnose(dir, logPath);
    assert.match(text, /checks/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('диагноз по несуществующему файлу лога сообщает об этом внятно', () => {
  const dir = makeProject();
  try {
    assert.throws(() => diagnose(dir, join(dir, 'нет-такого.log')), /лог/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

Функция `makeProject()` уже есть в этом файле и создаёт временный проект с конфигом, где `checks.test` равен `npm run test -- --run`.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `diagnose is not a function` или ошибка импорта.

- [ ] **Step 3: Реализовать**

В `src/cli.mjs` добавьте импорты и функцию:

```js
import { parseFailedLog, describeFailures } from './ci-log.mjs';

export function diagnose(projectDir, logPath) {
  let logText;
  try {
    logText = readFileSync(logPath, 'utf8');
  } catch (cause) {
    throw new Error(`не удалось прочитать лог ${logPath}: ${cause.message}`);
  }

  // Конфиг нужен только чтобы связать шаг с командой проверки. Если он сломан или
  // отсутствует, диагноз всё равно полезен — тем более что уронить CI мог именно он.
  let config = null;
  try {
    config = loadConfig(join(projectDir, '.pipeline', 'config.yml'));
  } catch {
    config = null;
  }

  return describeFailures(parseFailedLog(logText), config);
}
```

В диспетчере команд добавьте ветку `diagnose`, требующую два аргумента после имени команды, и включите её имя в подсказку по использованию. Диспетчер уже разбирает аргументы явно и падает с подсказкой при нехватке — сохраните этот стиль.

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, новых тестов 3.

- [ ] **Step 5: Проверить вручную на настоящей фикстуре**

Run: `node src/cli.mjs diagnose . tests/fixtures/failed-drift-check.log`
Expected: печатается диагноз с джобой `drift-check` и сообщением про несоответствие артефакта.

- [ ] **Step 6: Коммит**

```bash
git add src/cli.mjs tests/cli.test.mjs
git commit -m "feat: команда diagnose печатает диагноз по логу упавшего прогона"
```

---

### Task 3: Скилл `pipeline-ci-doctor`

**Files:**
- Create: `skills/pipeline-ci-doctor/SKILL.md`
- Create: `commands/fix-ci.md`
- Modify: `tests/skill-docs.test.mjs`

**Interfaces:**
- Consumes: `node ${CLAUDE_PLUGIN_ROOT}/src/cli.mjs diagnose <projectDir> <logPath>` (Task 2)
- Produces: скилл, на который ссылается `pipeline-ship` (Task 4) при красном CI

- [ ] **Step 1: Написать падающий тест**

Добавьте в `tests/skill-docs.test.mjs`:

```js
const DOCTOR = () => readText('skills/pipeline-ci-doctor/SKILL.md');

test('у скилла ci-doctor есть frontmatter с именем и описанием', () => {
  const text = DOCTOR();
  assert.match(text, /^---\n/);
  assert.match(text, /^name: pipeline-ci-doctor$/m);
  assert.match(text, /^description: .+$/m);
});

test('ci-doctor получает диагноз командой diagnose, а не читает сырой лог глазами', () => {
  assert.match(DOCTOR(), /cli\.mjs diagnose/);
});

test('ci-doctor ограничивает число попыток тремя', () => {
  const text = DOCTOR();
  assert.match(text, /три попытки|3 попытки/i);
  assert.match(text, /gh pr comment/, 'счётчик попыток должен фиксироваться комментарием к PR');
});

test('ci-doctor различает поломку кода и поломку самого пайплайна', () => {
  assert.match(DOCTOR(), /drift-check/);
});

test('команда fix-ci ссылается на скилл ci-doctor', () => {
  assert.match(readText('commands/fix-ci.md'), /pipeline-ci-doctor/);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `ENOENT: ... 'skills/pipeline-ci-doctor/SKILL.md'`.

- [ ] **Step 3: Написать скилл**

`skills/pipeline-ci-doctor/SKILL.md`:

```markdown
---
name: pipeline-ci-doctor
description: Use when CI on a pull request is red - выясняет причину по логу упавшей джобы, чинит и доводит PR до зелёного, не уходя в бесконечный цикл
---

# Починка красного CI

Задача — не «сделать джобу зелёной», а понять, что именно сломалось, и починить причину.
Замена проверки на более слабую, отключение теста и правка порога, чтобы «прошло», —
это не починка, а сокрытие: следующий раз то же самое сломается в проде.

## Шаг 1. Взять диагноз, а не сырой лог

Найти упавший прогон и сохранить лог:

    gh run list --limit 10 --json databaseId,conclusion,headBranch
    gh run view <id> --log-failed > /tmp/failed.log

Получить диагноз:

    node ${CLAUDE_PLUGIN_ROOT}/src/cli.mjs diagnose . /tmp/failed.log

Он покажет упавшую джобу, шаг, сообщения об ошибках и последние строки вывода — без
временных меток, ANSI-кодов и эха команд. Если шаг соответствует проверке из
`.pipeline/config.yml`, диагноз назовёт её команду и скажет, обязательная ли она.

Читать весь сырой лог не нужно. Открывайте его, только если диагноза не хватило —
и тогда скажите об этом в отчёте: значит, разбор чего-то не понимает.

## Шаг 2. Отделить поломку кода от поломки пайплайна

Красная джоба `drift-check` означает не ошибку в коде, а рассогласование: `.pipeline/config.yml`
изменили, а артефакты не перегенерировали. Чинится одной командой:

    node ${CLAUDE_PLUGIN_ROOT}/src/cli.mjs generate .

После неё `.github/workflows/ci.yml` и `scripts/pipeline.sh` нужно закоммитить вместе с конфигом.

Красная джоба `checks` означает, что упала конкретная проверка проекта. Её команду диагноз
уже назвал — воспроизведите падение локально той же командой, прежде чем что-то править.
Правка вслепую по тексту ошибки из CI — самый частый способ потратить попытку впустую.

## Шаг 3. Починить причину

Воспроизвели локально — чините. Проверка проходит локально — коммит и push в ту же ветку.

Если падение не воспроизводится локально, причина в различии окружений: версия Node, регистр
имён файлов, переводы строк, отсутствующая переменная окружения, порядок тестов. Ищите различие,
а не подгоняйте код.

## Шаг 4. Считать попытки

Попыток три. Каждая — это push с исправлением и ожидание результата.

После каждой попытки оставьте комментарий к PR:

    gh pr comment <номер> --body "Попытка N: <что было сломано> → <что изменено> → <результат>"

Счётчик держится в комментариях, а не в памяти: сессия может прерваться, а человеку видно,
что происходило. Перед первой попыткой прочитайте существующие комментарии
(`gh pr view <номер> --json comments`), чтобы продолжить счёт, а не начать заново.

Три попытки исчерпаны — остановитесь и отчитайтесь человеку: что падало, что пробовали,
почему не сработало, какая гипотеза осталась непроверенной. Это нормальный исход, а не провал.
Продолжать вслепую четвёртый раз — значит жечь время и бюджет.

## Чего не делать

- Не отключайте и не ослабляйте упавшую проверку, чтобы получить зелёный.
- Не убирайте проверку из `required` в конфиге ради прохождения PR.
- Не пушьте с `--force` в ветку PR.
- Не объявляйте починку успешной, не дождавшись зелёного: `gh pr checks --watch`.
```

- [ ] **Step 4: Написать команду**

`commands/fix-ci.md`:

```markdown
---
description: Разобраться, почему упал CI на PR, и починить
---

Используй скилл pipeline-ci-doctor, чтобы разобраться в причине красного CI и починить её.
Помни: три попытки, каждая фиксируется комментарием к PR, а ослабление проверки ради
зелёного — это не починка.
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, новых тестов 5.

- [ ] **Step 6: Доказать, что тесты способны падать**

Временно удалите из скилла строку с `cli.mjs diagnose`:

```bash
cp skills/pipeline-ci-doctor/SKILL.md /tmp/doctor.bak
grep -v "cli.mjs diagnose" /tmp/doctor.bak > skills/pipeline-ci-doctor/SKILL.md
node --test tests/skill-docs.test.mjs
cp /tmp/doctor.bak skills/pipeline-ci-doctor/SKILL.md
node --test tests/skill-docs.test.mjs
```

Expected: сначала одна упавшая проверка, затем все зелёные. Приведите оба вывода.

- [ ] **Step 7: Коммит**

```bash
git add skills/pipeline-ci-doctor commands/fix-ci.md tests/skill-docs.test.mjs
git commit -m "feat: скилл починки красного CI и команда fix-ci"
```

---

### Task 4: Скилл `pipeline-ship`

**Files:**
- Create: `skills/pipeline-ship/SKILL.md`
- Create: `commands/ship.md`
- Modify: `tests/skill-docs.test.mjs`

**Interfaces:**
- Consumes: скилл `pipeline-ci-doctor` (Task 3); `.pipeline/config.yml` — поля `autonomy`, `stage`, `checks`, `required`
- Produces: точка входа `/pipeline:ship <задача>` для повседневной работы

- [ ] **Step 1: Написать падающий тест**

Добавьте в `tests/skill-docs.test.mjs`:

```js
const SHIP = () => readText('skills/pipeline-ship/SKILL.md');

test('у скилла ship есть frontmatter с именем и описанием', () => {
  const text = SHIP();
  assert.match(text, /^---\n/);
  assert.match(text, /^name: pipeline-ship$/m);
  assert.match(text, /^description: .+$/m);
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `ENOENT: ... 'skills/pipeline-ship/SKILL.md'`.

- [ ] **Step 3: Написать скилл**

`skills/pipeline-ship/SKILL.md`:

```markdown
---
name: pipeline-ship
description: Use when taking a task from prompt to merged PR - ветка, тесты, проверки, PR, зелёный CI и мердж по режиму автономности проекта
---

# Проведение задачи от промпта до мерджа

Скилл ведёт задачу через одинаковый путь: ветка → изменение → локальные проверки → PR →
зелёный CI → мердж по режиму, записанному в проекте. Он не описывает, как программировать —
для этого есть навык разработки через тесты; он описывает дисциплину вокруг кода.

## Шаг 1. Прочитать состояние проекта

`.pipeline/config.yml` — что запускать (`checks`), что обязательно (`required`), кто принимает
решение о мердже (`autonomy`), на какой стадии проект (`stage`).

`.pipeline/conventions.md`, если он есть, — принятые в проекте решения. Их нужно соблюдать,
а новые принятые по ходу решения дописывать туда же. Файла может не быть — это нормально.

Пайплайн не настроен (нет `.pipeline/config.yml`) — остановитесь и предложите `/pipeline:init`.

## Шаг 2. Ветка

    git switch -c feat/<короткое-имя-задачи>

От актуального `main`: сначала `git switch main && git pull`.

## Шаг 3. Сначала тест, если проект вышел из наброска

При `stage: sketch` можно писать код сразу — на этой стадии тесты мешают искать форму решения.

Начиная со `stage: shaping` сначала пишется тест на желаемое поведение, и он должен
покраснеть до того, как появится реализация. Тест, который не падал ни разу, ничего не
доказывает: в этом проекте уже отгружались тесты, проходившие при любой реализации.

Тест описывает поведение, а не устройство: он должен пережить переписывание внутренностей.

## Шаг 4. Локальные проверки до пуша

    sh scripts/pipeline.sh all

Гонять до зелёного здесь, а не в CI. Каждый круг «push → ждать CI → красный» стоит минут,
локальный прогон — секунд.

Если менялся `.pipeline/config.yml`, перегенерируйте артефакты, иначе `drift-check` покраснеет:

    node ${CLAUDE_PLUGIN_ROOT}/src/cli.mjs generate .

## Шаг 5. PR

    git push -u origin feat/<имя>
    gh pr create --title "<что сделано>" --body "<что сделано; что проверено и как>"

В теле PR — что изменилось и какими командами это проверено. Не пересказ диффа: его видно.

## Шаг 6. Зелёный CI

    gh pr checks --watch

Красный — передайте работу скиллу `pipeline-ci-doctor`. Он возьмёт диагноз по логу, починит
причину и ограничит число попыток тремя. Не чините вслепую сами и не считайте попытки в уме.

## Шаг 7. Мердж по режиму автономности

Поле `autonomy` в конфиге определяет, кто принимает решение:

- `full` — мерджить самостоятельно: `gh pr merge --auto --squash --delete-branch`;
- `merge-gate` — остановиться. Сообщить человеку, что PR зелёный и ждёт его решения. Не мерджить;
- `prod-gate` — смерджить самостоятельно, но деплой не запускать.

Про `prod-gate` важно: деплой пока не реализован — он появится в отдельном плане. Смерджив PR
в этом режиме, скажите прямо, что изменения в `main`, но никуда не выкачены. Не создавайте
впечатление, будто что-то развёрнуто.

## Критерий завершения

Задача завершена, когда PR смерджен (`full`, `prod-gate`) либо когда он зелёный и человек
уведомлён (`merge-gate`). Зелёные локальные проверки при красном или неизвестном CI —
не завершение.
```

- [ ] **Step 4: Написать команду**

`commands/ship.md`:

```markdown
---
description: Провести задачу от промпта до смерджённого PR
---

Используй скилл pipeline-ship, чтобы провести задачу через ветку, локальные проверки, PR
и зелёный CI до мерджа по режиму автономности проекта.

Задача: $ARGUMENTS
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, новых тестов 7.

- [ ] **Step 6: Доказать, что тесты способны падать**

Временно удалите из скилла строку с `pipeline-ci-doctor`, запустите `node --test tests/skill-docs.test.mjs`, убедитесь в красном, верните файл, убедитесь в зелёном. Приведите оба вывода.

- [ ] **Step 7: Коммит**

```bash
git add skills/pipeline-ship commands/ship.md tests/skill-docs.test.mjs
git commit -m "feat: скилл проведения задачи до мерджа и команда ship"
```

---

### Task 5: Догфудинг — провести задачу собственным циклом

**Files:**
- Modify: `README.md`
- Test: настоящий прогон CI на PR

**Interfaces:**
- Consumes: всё предыдущее
- Produces: доказательство, что цикл работает на настоящем PR, а не только в тестах

Задача для прогона выбрана намеренно мелкой и осмысленной: раздел «Границы текущей версии»
в `README.md` перечисляет цикл `ship` и диагностику CI как нереализованные — после этого плана
это неправда, и README нужно обновить.

- [ ] **Step 1: Прочитать конфиг репозитория**

Run: `cat .pipeline/config.yml`
Отметьте значение `autonomy` — оно определяет, чем закончится прогон. В этом репозитории
ожидается `merge-gate`, то есть скилл должен остановиться на зелёном PR и не мерджить.

- [ ] **Step 2: Провести задачу по скиллу ship**

Следуя `skills/pipeline-ship/SKILL.md` шаг за шагом, проведите изменение README: убрать из
раздела «Границы текущей версии» пункты про цикл `ship` и автоматическую диагностику упавшего CI,
перенести их в список работающего.

Важно: пройдите путь скилла буквально, а не «сделайте изменение как удобно». Смысл задачи —
проверить сам скилл. Всякое место, где инструкция оказалась неполной, неоднозначной или
неверной, записывайте — это результат задачи, не менее ценный, чем изменённый README.

- [ ] **Step 3: Убедиться, что тест границ обновлён**

В `tests/manifests.test.mjs` есть тест «README честно перечисляет, что пока не поддерживается»,
который требует упоминания `ship` среди границ. После изменения README он покраснеет — это
правильное срабатывание, а не помеха: тест сделал ровно то, ради чего написан.

Обновите список в тесте, убрав `ship` и оставив пункты, которые действительно не реализованы
(`python`, `деплой`). Тест обязан остаться способным падать.

- [ ] **Step 4: Довести PR до зелёного**

Run: `gh pr checks --watch`
Expected: все джобы зелёные. Красное — работайте по скиллу `pipeline-ci-doctor` и отметьте
в отчёте, помог ли диагноз.

- [ ] **Step 5: Остановиться, как велит режим**

При `autonomy: merge-gate` PR не мерджить. Сообщить номер PR и то, что он ждёт решения человека.

- [ ] **Step 6: Записать находки о скилле**

Составьте список мест, где скиллы `pipeline-ship` и `pipeline-ci-doctor` оказались неполными
или неверными при настоящем прохождении. Если таких мест нет — скажите это прямо, но только
если действительно шли по инструкции буквально.

---

## Проверка готовности плана

По завершении пяти задач должно выполняться:

- `npm test` зелёный; число тестов выросло на 26 относительно 70 до начала плана;
- `node src/cli.mjs diagnose . tests/fixtures/failed-drift-check.log` печатает внятный диагноз;
- команды `/pipeline:ship` и `/pipeline:fix-ci` присутствуют в `commands/` под именами,
  которые дают именно эти слэш-команды;
- на настоящем PR цикл пройден до зелёного CI;
- README не числит реализованное среди нереализованного.

## Что осознанно отложено

| Раздел спецификации | План |
|---|---|
| §8 деплой на VPS, healthcheck, откат, бэкап перед миграцией | план 3 |
| §6 стадии, `state.json`, храповик, `baseline.json`, скилл `evolve` | план 4 |
| §6 `conventions.md` как рабочий механизм памяти между сессиями | план 4; здесь скилл только читает файл, если он есть |
| §9 хуки `PreToolUse` | план 4 — они зависят от стадии проекта |
| §10 матричные тесты шаблона на четырёх стеках | план 5 |
