# Agent Pipeline: генератор и init — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Плагин Claude Code, который разворачивает в node-ts проекте работающий пайплайн: конфиг `.pipeline/config.yml` порождает `.github/workflows/ci.yml` и `scripts/pipeline.sh`, а CI ловит расхождение между конфигом и артефактами.

**Architecture:** Репозиторий `agent-pipeline` — одновременно marketplace плагина Claude Code и генератор. Генератор написан на Node (ESM, единственная зависимость — `yaml`), читает конфиг, отдаёт строки артефактов и вписывает в них sha256 конфига. CI проекта сверяет этот хеш командой `sha256sum`, поэтому парсер YAML в CI не нужен ни для одного стека. Скилл `pipeline-init` вызывает генератор и доводит проект до зелёного CI.

**Tech Stack:** Node 24 (ESM, встроенный `node:test`), пакет `yaml`, GitHub Actions, `gh` CLI, POSIX sh.

## Global Constraints

- Версия конфига: `version: 1`. Любое другое значение — ошибка загрузки.
- Стеки в этом плане: только `node-ts`. Значения `python`, `go`, `java` принимаются валидатором, но генерация для них выбрасывает `UnsupportedStackError` — их реализует отдельный план.
- Единственная runtime-зависимость генератора — `yaml`. Никаких других npm-пакетов.
- Тесты только на `node:test` и `node:assert/strict`. Тест-фреймворки не добавлять.
- Все генерируемые файлы начинаются со строки-маркера `# generated-from-config: sha256:<64 hex>`.
- Генерируемые `.sh` файлы обязаны иметь LF-окончания строк: репозиторий содержит `.gitattributes` с `*.sh text eol=lf`. Разработка ведётся на Windows, CI — на `ubuntu-latest`; CRLF в `.sh` ломает выполнение в CI.
- Ключи в `checks` обязаны соответствовать `^[a-z][a-z0-9_]*$` — они становятся именами функций в sh.
- Идентичность коммитов в этом репозитории уже настроена локально (`thetaDEM`). Не менять её и не трогать глобальный git config.
- Коммит-сообщения на русском, в формате `<type>: <описание>`. Не добавлять подпись соавтора.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `package.json` | манифест npm, скрипт `test`, зависимость `yaml` |
| `.gitattributes` | LF для `.sh`, защита от CRLF на Windows |
| `src/config.mjs` | загрузка, валидация конфига, вычисление хеша |
| `src/generate-sh.mjs` | конфиг → текст `scripts/pipeline.sh` |
| `src/generate-ci.mjs` | конфиг → текст `.github/workflows/ci.yml` |
| `src/cli.mjs` | команды `generate` и `check`, запись файлов на диск |
| `tests/config.test.mjs` | тесты загрузки и валидации |
| `tests/generate-sh.test.mjs` | тесты генерации sh |
| `tests/generate-ci.test.mjs` | тесты генерации workflow |
| `tests/cli.test.mjs` | тесты записи файлов и обнаружения дрейфа |
| `templates/common/config.yml.tmpl` | заготовка конфига с шапкой |
| `templates/stacks/node-ts/` | Dockerfile, smoke-тест, пресет проверок |
| `skills/pipeline-init/SKILL.md` | инструкция агенту по развёртыванию |
| `commands/pipeline-init.md` | слэш-команда `/pipeline:init` |
| `.claude-plugin/plugin.json` | манифест плагина |
| `.claude-plugin/marketplace.json` | манифест marketplace |

Разделение генераторов по файлам умышленное: `generate-sh` и `generate-ci` меняются по разным причинам (первый — при изменении набора проверок, второй — при изменении устройства CI) и тестируются независимо.

---

### Task 1: Загрузка и валидация конфига

**Files:**
- Create: `package.json`
- Create: `.gitattributes`
- Create: `src/config.mjs`
- Test: `tests/config.test.mjs`

**Interfaces:**
- Consumes: ничего
- Produces:
  - `loadConfig(configPath: string) -> Config` — читает файл, парсит YAML, валидирует, возвращает объект. Бросает `ConfigError`.
  - `parseConfig(rawText: string) -> Config` — то же без обращения к диску.
  - `configHash(rawText: string) -> string` — возвращает 64 hex-символа sha256 от текста конфига.
  - `class ConfigError extends Error` с полем `field: string`.
  - Тип `Config`: `{ version: 1, project: { name, stack, goal }, autonomy, stage, checks: Record<string,string>, required: string[], deploy?: object }`.

- [ ] **Step 1: Создать npm-манифест и .gitattributes**

`package.json`:

```json
{
  "name": "agent-pipeline",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Генератор пайплайна и плагин Claude Code",
  "scripts": {
    "test": "node --test tests/"
  },
  "dependencies": {
    "yaml": "^2.6.0"
  }
}
```

`.gitattributes`:

```
* text=auto
*.sh text eol=lf
templates/** text eol=lf
```

- [ ] **Step 2: Установить зависимость**

Run: `npm install`
Expected: создан `package-lock.json`, в `node_modules` присутствует `yaml`.

- [ ] **Step 3: Написать падающий тест**

`tests/config.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConfig, configHash, ConfigError } from '../src/config.mjs';

const VALID = `
version: 1
project:
  name: my-app
  stack: node-ts
  goal: "пример"
autonomy: prod-gate
stage: sketch
checks:
  test: npm run test -- --run
  lint: npm run lint
required: [test]
`;

test('парсит корректный конфиг', () => {
  const cfg = parseConfig(VALID);
  assert.equal(cfg.project.name, 'my-app');
  assert.equal(cfg.project.stack, 'node-ts');
  assert.equal(cfg.autonomy, 'prod-gate');
  assert.deepEqual(cfg.required, ['test']);
  assert.equal(cfg.checks.lint, 'npm run lint');
});

test('отвергает неизвестную версию', () => {
  const bad = VALID.replace('version: 1', 'version: 2');
  assert.throws(() => parseConfig(bad), (e) => e instanceof ConfigError && e.field === 'version');
});

test('отвергает неизвестный стек', () => {
  const bad = VALID.replace('stack: node-ts', 'stack: cobol');
  assert.throws(() => parseConfig(bad), (e) => e instanceof ConfigError && e.field === 'project.stack');
});

test('отвергает неизвестный режим автономности', () => {
  const bad = VALID.replace('autonomy: prod-gate', 'autonomy: yolo');
  assert.throws(() => parseConfig(bad), (e) => e instanceof ConfigError && e.field === 'autonomy');
});

test('отвергает required с ключом, которого нет в checks', () => {
  const bad = VALID.replace('required: [test]', 'required: [deploy]');
  assert.throws(() => parseConfig(bad), (e) => e instanceof ConfigError && e.field === 'required');
});

test('отвергает имя проверки, непригодное для имени функции sh', () => {
  const bad = VALID.replace('  lint: npm run lint', '  Lint-All: npm run lint');
  assert.throws(() => parseConfig(bad), (e) => e instanceof ConfigError && e.field === 'checks');
});

test('отвергает пустой набор проверок', () => {
  const bad = `
version: 1
project: { name: a, stack: node-ts, goal: g }
autonomy: full
stage: sketch
checks: {}
required: []
`;
  assert.throws(() => parseConfig(bad), (e) => e instanceof ConfigError && e.field === 'checks');
});

test('хеш стабилен и имеет длину 64', () => {
  const h1 = configHash(VALID);
  const h2 = configHash(VALID);
  assert.equal(h1, h2);
  assert.match(h1, /^[0-9a-f]{64}$/);
});

test('хеш меняется при изменении текста', () => {
  assert.notEqual(configHash(VALID), configHash(VALID + '\n# комментарий\n'));
});
```

- [ ] **Step 4: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/config.mjs'`.

- [ ] **Step 5: Реализовать загрузчик**

`src/config.mjs`:

```js
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

const STACKS = ['node-ts', 'python', 'go', 'java'];
const AUTONOMY = ['full', 'merge-gate', 'prod-gate'];
const STAGES = ['sketch', 'shaping', 'product', 'sustained'];
const CHECK_NAME = /^[a-z][a-z0-9_]*$/;

export class ConfigError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
  }
}

function requireOneOf(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ConfigError(`${field}: ожидалось одно из ${allowed.join(', ')}, получено ${JSON.stringify(value)}`, field);
  }
}

export function parseConfig(rawText) {
  let doc;
  try {
    doc = parseYaml(rawText);
  } catch (cause) {
    throw new ConfigError(`не удалось разобрать YAML: ${cause.message}`, 'yaml');
  }
  if (doc === null || typeof doc !== 'object') {
    throw new ConfigError('конфиг пуст или не является объектом', 'root');
  }
  if (doc.version !== 1) {
    throw new ConfigError(`version: поддерживается только 1, получено ${JSON.stringify(doc.version)}`, 'version');
  }

  const project = doc.project;
  if (!project || typeof project !== 'object') {
    throw new ConfigError('project: секция отсутствует', 'project');
  }
  if (typeof project.name !== 'string' || project.name.trim() === '') {
    throw new ConfigError('project.name: непустая строка обязательна', 'project.name');
  }
  requireOneOf(project.stack, STACKS, 'project.stack');
  requireOneOf(doc.autonomy, AUTONOMY, 'autonomy');
  requireOneOf(doc.stage, STAGES, 'stage');

  const checks = doc.checks;
  if (!checks || typeof checks !== 'object' || Object.keys(checks).length === 0) {
    throw new ConfigError('checks: нужна хотя бы одна проверка', 'checks');
  }
  for (const [name, command] of Object.entries(checks)) {
    if (!CHECK_NAME.test(name)) {
      throw new ConfigError(`checks: имя ${JSON.stringify(name)} не подходит для имени функции sh, ожидается ${CHECK_NAME}`, 'checks');
    }
    if (typeof command !== 'string' || command.trim() === '') {
      throw new ConfigError(`checks.${name}: команда должна быть непустой строкой`, 'checks');
    }
  }

  const required = doc.required ?? [];
  if (!Array.isArray(required)) {
    throw new ConfigError('required: ожидается список', 'required');
  }
  for (const name of required) {
    if (!Object.hasOwn(checks, name)) {
      throw new ConfigError(`required: ${JSON.stringify(name)} отсутствует в checks`, 'required');
    }
  }

  return { ...doc, required };
}

export function loadConfig(configPath) {
  let rawText;
  try {
    rawText = readFileSync(configPath, 'utf8');
  } catch (cause) {
    throw new ConfigError(`не удалось прочитать ${configPath}: ${cause.message}`, 'file');
  }
  return parseConfig(rawText);
}

export function configHash(rawText) {
  return createHash('sha256').update(rawText, 'utf8').digest('hex');
}
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 9 тестов.

- [ ] **Step 7: Коммит**

```bash
git add package.json package-lock.json .gitattributes src/config.mjs tests/config.test.mjs
git commit -m "feat: загрузка и валидация .pipeline/config.yml"
```

---

### Task 2: Генератор `scripts/pipeline.sh`

**Files:**
- Create: `src/generate-sh.mjs`
- Test: `tests/generate-sh.test.mjs`

**Interfaces:**
- Consumes: тип `Config` из Task 1
- Produces: `generatePipelineSh(config: Config, hash: string) -> string` — текст sh-скрипта с LF-окончаниями, первая строка `#!/usr/bin/env sh`, вторая — маркер хеша.

- [ ] **Step 1: Написать падающий тест**

`tests/generate-sh.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePipelineSh } from '../src/generate-sh.mjs';

const CFG = {
  version: 1,
  project: { name: 'my-app', stack: 'node-ts', goal: 'g' },
  autonomy: 'prod-gate',
  stage: 'sketch',
  checks: { test: 'npm run test -- --run', lint: 'npm run lint' },
  required: ['test'],
};
const HASH = 'a'.repeat(64);

test('начинается с шебанга и маркера хеша', () => {
  const lines = generatePipelineSh(CFG, HASH).split('\n');
  assert.equal(lines[0], '#!/usr/bin/env sh');
  assert.equal(lines[1], `# generated-from-config: sha256:${HASH}`);
});

test('содержит функцию на каждую проверку с её командой', () => {
  const sh = generatePipelineSh(CFG, HASH);
  assert.match(sh, /^check_test\(\) \{$/m);
  assert.match(sh, /^\s+npm run test -- --run$/m);
  assert.match(sh, /^check_lint\(\) \{$/m);
  assert.match(sh, /^\s+npm run lint$/m);
});

test('включает set -eu, чтобы упавшая команда валила скрипт', () => {
  assert.match(generatePipelineSh(CFG, HASH), /^set -eu$/m);
});

test('диспетчер знает каждую проверку и слово all', () => {
  const sh = generatePipelineSh(CFG, HASH);
  assert.match(sh, /^\s+test\) check_test ;;$/m);
  assert.match(sh, /^\s+lint\) check_lint ;;$/m);
  assert.match(sh, /^\s+all\) check_test; check_lint ;;$/m);
});

test('неизвестный аргумент даёт код возврата 2', () => {
  assert.match(generatePipelineSh(CFG, HASH), /exit 2/);
});

test('не содержит CR', () => {
  assert.equal(generatePipelineSh(CFG, HASH).includes('\r'), false);
});

test('порядок проверок сохраняет порядок ключей конфига', () => {
  const reordered = { ...CFG, checks: { lint: 'npm run lint', test: 'npm run test -- --run' } };
  assert.match(generatePipelineSh(reordered, HASH), /^\s+all\) check_lint; check_test ;;$/m);
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/generate-sh.mjs'`.

- [ ] **Step 3: Реализовать генератор**

`src/generate-sh.mjs`:

```js
export function generatePipelineSh(config, hash) {
  const names = Object.keys(config.checks);
  const lines = [
    '#!/usr/bin/env sh',
    `# generated-from-config: sha256:${hash}`,
    '# Файл сгенерирован из .pipeline/config.yml. Правки затрутся при следующей генерации:',
    '# меняйте .pipeline/config.yml и перезапускайте генерацию.',
    'set -eu',
    '',
  ];

  for (const name of names) {
    lines.push(`check_${name}() {`);
    lines.push(`  ${config.checks[name]}`);
    lines.push('}');
    lines.push('');
  }

  lines.push('case "${1:-all}" in');
  for (const name of names) {
    lines.push(`  ${name}) check_${name} ;;`);
  }
  lines.push(`  all) ${names.map((n) => `check_${n}`).join('; ')} ;;`);
  lines.push('  *)');
  lines.push(`    echo "неизвестная проверка: $1 (доступны: ${names.join(', ')}, all)" >&2`);
  lines.push('    exit 2');
  lines.push('    ;;');
  lines.push('esac');
  lines.push('');

  return lines.join('\n');
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 16 тестов суммарно.

- [ ] **Step 5: Коммит**

```bash
git add src/generate-sh.mjs tests/generate-sh.test.mjs
git commit -m "feat: генерация scripts/pipeline.sh из конфига"
```

---

### Task 3: Генератор `.github/workflows/ci.yml`

**Files:**
- Create: `src/generate-ci.mjs`
- Test: `tests/generate-ci.test.mjs`

**Interfaces:**
- Consumes: тип `Config` из Task 1
- Produces:
  - `generateCi(config: Config, hash: string) -> string` — текст workflow.
  - `class UnsupportedStackError extends Error` с полем `stackName: string`. Поле named именно так, а не `stack`: у `Error` свойство `stack` занято стектрейсом, перезапись ломает отладку.

Устройство workflow: две джобы. `drift-check` сверяет маркеры хеша в артефактах с sha256 конфига одной командой `sha256sum`. `checks` ставит окружение стека и вызывает `sh scripts/pipeline.sh <имя>` по одному шагу на проверку; проверки из `required` валят джобу, остальные помечены `continue-on-error: true`.

Известная особенность, не баг: сериализатор может записать ключ `on` как `"on"` в кавычках. В YAML 1.1 голое `on` означало булево `true`, поэтому библиотеки его экранируют. GitHub Actions принимает обе формы, тесты тоже — не «чинить» это руками, иначе появится дрейф.

- [ ] **Step 1: Написать падающий тест**

`tests/generate-ci.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCi, UnsupportedStackError } from '../src/generate-ci.mjs';
import { parse as parseYaml } from 'yaml';

const CFG = {
  version: 1,
  project: { name: 'my-app', stack: 'node-ts', goal: 'g' },
  autonomy: 'prod-gate',
  stage: 'sketch',
  checks: { test: 'npm run test -- --run', lint: 'npm run lint' },
  required: ['test'],
};
const HASH = 'b'.repeat(64);

test('первая строка — маркер хеша', () => {
  assert.equal(generateCi(CFG, HASH).split('\n')[0], `# generated-from-config: sha256:${HASH}`);
});

test('результат — валидный YAML с двумя джобами', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  assert.deepEqual(Object.keys(doc.jobs).sort(), ['checks', 'drift-check']);
});

test('запускается на pull_request и на push в main', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  assert.ok(Object.hasOwn(doc.on, 'pull_request'));
  assert.deepEqual(doc.on.push.branches, ['main']);
});

test('drift-check сверяет хеш конфига без парсинга YAML', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  const script = doc.jobs['drift-check'].steps.map((s) => s.run ?? '').join('\n');
  assert.match(script, /sha256sum \.pipeline\/config\.yml/);
  assert.match(script, /generated-from-config/);
});

test('обязательная проверка не помечена continue-on-error', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  const step = doc.jobs.checks.steps.find((s) => s.name === 'test');
  assert.equal(step.run, 'sh scripts/pipeline.sh test');
  assert.equal(step['continue-on-error'], undefined);
});

test('необязательная проверка помечена continue-on-error', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  const step = doc.jobs.checks.steps.find((s) => s.name === 'lint');
  assert.equal(step['continue-on-error'], true);
});

test('для node-ts ставит Node и выполняет npm ci', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  const uses = doc.jobs.checks.steps.map((s) => s.uses).filter(Boolean);
  assert.ok(uses.some((u) => u.startsWith('actions/setup-node@')));
  assert.ok(doc.jobs.checks.steps.some((s) => s.run === 'npm ci'));
});

test('нереализованный стек отвергается явной ошибкой', () => {
  const cfg = { ...CFG, project: { ...CFG.project, stack: 'go' } };
  assert.throws(() => generateCi(cfg, HASH), (e) => e instanceof UnsupportedStackError && e.stackName === 'go');
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/generate-ci.mjs'`.

- [ ] **Step 3: Реализовать генератор**

`src/generate-ci.mjs`:

```js
import { stringify as stringifyYaml } from 'yaml';

export class UnsupportedStackError extends Error {
  constructor(stackName) {
    super(`стек ${stackName} пока не поддерживается генератором CI`);
    this.name = 'UnsupportedStackError';
    // Именно stackName, а не stack: у Error свойство stack — это стектрейс.
    this.stackName = stackName;
  }
}

const SETUP_STEPS = {
  'node-ts': [
    { uses: 'actions/setup-node@v4', with: { 'node-version': '24', cache: 'npm' } },
    { run: 'npm ci' },
  ],
};

const DRIFT_SCRIPT = [
  'expected=$(sha256sum .pipeline/config.yml | cut -d " " -f 1)',
  'status=0',
  'for f in .github/workflows/ci.yml scripts/pipeline.sh; do',
  '  actual=$(sed -n "s/^# generated-from-config: sha256://p" "$f" | head -n 1)',
  '  if [ "$actual" != "$expected" ]; then',
  '    echo "::error file=$f::артефакт не соответствует .pipeline/config.yml, перегенерируйте пайплайн"',
  '    status=1',
  '  fi',
  'done',
  'exit $status',
].join('\n');

export function generateCi(config, hash) {
  const setup = SETUP_STEPS[config.project.stack];
  if (!setup) {
    throw new UnsupportedStackError(config.project.stack);
  }

  const checkSteps = Object.keys(config.checks).map((name) => {
    const step = { name, run: `sh scripts/pipeline.sh ${name}` };
    if (!config.required.includes(name)) {
      step['continue-on-error'] = true;
    }
    return step;
  });

  const workflow = {
    name: 'CI',
    on: { pull_request: null, push: { branches: ['main'] } },
    jobs: {
      'drift-check': {
        'runs-on': 'ubuntu-latest',
        steps: [
          { uses: 'actions/checkout@v4' },
          { name: 'Сверить артефакты с конфигом', run: DRIFT_SCRIPT },
        ],
      },
      checks: {
        'runs-on': 'ubuntu-latest',
        steps: [{ uses: 'actions/checkout@v4' }, ...setup, ...checkSteps],
      },
    },
  };

  return `# generated-from-config: sha256:${hash}\n`
    + '# Файл сгенерирован из .pipeline/config.yml. Правки затрутся при следующей генерации.\n'
    + stringifyYaml(workflow, { lineWidth: 0 });
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 24 теста суммарно.

- [ ] **Step 5: Коммит**

```bash
git add src/generate-ci.mjs tests/generate-ci.test.mjs
git commit -m "feat: генерация workflow CI с джобой drift-check"
```

---

### Task 4: CLI — запись артефактов и обнаружение дрейфа

**Files:**
- Create: `src/cli.mjs`
- Test: `tests/cli.test.mjs`

**Interfaces:**
- Consumes: `loadConfig`, `configHash` (Task 1), `generatePipelineSh` (Task 2), `generateCi` (Task 3)
- Produces:
  - `generateInto(projectDir: string) -> { written: string[], hash: string }` — читает `<projectDir>/.pipeline/config.yml`, пишет `<projectDir>/scripts/pipeline.sh` и `<projectDir>/.github/workflows/ci.yml`.
  - `checkDrift(projectDir: string) -> { ok: boolean, stale: string[] }` — ничего не пишет.
  - Запуск из терминала: `node src/cli.mjs generate <projectDir>` и `node src/cli.mjs check <projectDir>`; при дрейфе `check` завершается кодом 1.

- [ ] **Step 1: Написать падающий тест**

`tests/cli.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateInto, checkDrift } from '../src/cli.mjs';

const CONFIG_TEXT = `
version: 1
project:
  name: my-app
  stack: node-ts
  goal: "пример"
autonomy: prod-gate
stage: sketch
checks:
  test: npm run test -- --run
required: [test]
`;

function makeProject(configText = CONFIG_TEXT) {
  const dir = mkdtempSync(join(tmpdir(), 'pipeline-'));
  mkdirSync(join(dir, '.pipeline'), { recursive: true });
  writeFileSync(join(dir, '.pipeline', 'config.yml'), configText, 'utf8');
  return dir;
}

test('пишет оба артефакта и сообщает пути', () => {
  const dir = makeProject();
  try {
    const { written } = generateInto(dir);
    assert.deepEqual(written.sort(), [
      join(dir, '.github', 'workflows', 'ci.yml'),
      join(dir, 'scripts', 'pipeline.sh'),
    ].sort());
    assert.match(readFileSync(join(dir, 'scripts', 'pipeline.sh'), 'utf8'), /check_test\(\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('оба артефакта несут один и тот же хеш конфига', () => {
  const dir = makeProject();
  try {
    const { hash } = generateInto(dir);
    for (const f of [join(dir, 'scripts', 'pipeline.sh'), join(dir, '.github', 'workflows', 'ci.yml')]) {
      assert.ok(readFileSync(f, 'utf8').includes(`# generated-from-config: sha256:${hash}`));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('записанный sh не содержит CR', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    assert.equal(readFileSync(join(dir, 'scripts', 'pipeline.sh'), 'utf8').includes('\r'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('сразу после генерации дрейфа нет', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    assert.deepEqual(checkDrift(dir), { ok: true, stale: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('правка конфига без перегенерации даёт дрейф в обоих артефактах', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    writeFileSync(join(dir, '.pipeline', 'config.yml'), CONFIG_TEXT + '\n# правка\n', 'utf8');
    const result = checkDrift(dir);
    assert.equal(result.ok, false);
    assert.equal(result.stale.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('повторная генерация после правки снимает дрейф', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    writeFileSync(join(dir, '.pipeline', 'config.yml'), CONFIG_TEXT + '\n# правка\n', 'utf8');
    generateInto(dir);
    assert.equal(checkDrift(dir).ok, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('отсутствующий артефакт считается устаревшим, а не падением', () => {
  const dir = makeProject();
  try {
    generateInto(dir);
    rmSync(join(dir, 'scripts', 'pipeline.sh'));
    const result = checkDrift(dir);
    assert.equal(result.ok, false);
    assert.ok(result.stale.some((p) => p.endsWith('pipeline.sh')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `Cannot find module '../src/cli.mjs'`.

- [ ] **Step 3: Реализовать CLI**

`src/cli.mjs`:

```js
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadConfig, configHash } from './config.mjs';
import { generatePipelineSh } from './generate-sh.mjs';
import { generateCi } from './generate-ci.mjs';

const MARKER = '# generated-from-config: sha256:';

function artifactPaths(projectDir) {
  return {
    configPath: join(projectDir, '.pipeline', 'config.yml'),
    shPath: join(projectDir, 'scripts', 'pipeline.sh'),
    ciPath: join(projectDir, '.github', 'workflows', 'ci.yml'),
  };
}

function writeFileLf(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n/g, '\n'), 'utf8');
}

export function generateInto(projectDir) {
  const { configPath, shPath, ciPath } = artifactPaths(projectDir);
  const config = loadConfig(configPath);
  const hash = configHash(readFileSync(configPath, 'utf8'));

  writeFileLf(shPath, generatePipelineSh(config, hash));
  writeFileLf(ciPath, generateCi(config, hash));

  return { written: [shPath, ciPath], hash };
}

export function checkDrift(projectDir) {
  const { configPath, shPath, ciPath } = artifactPaths(projectDir);
  const expected = configHash(readFileSync(configPath, 'utf8'));
  const stale = [];

  for (const path of [shPath, ciPath]) {
    if (!existsSync(path)) {
      stale.push(path);
      continue;
    }
    const line = readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith(MARKER));
    if (line?.slice(MARKER.length).trim() !== expected) {
      stale.push(path);
    }
  }

  return { ok: stale.length === 0, stale };
}

const [, , command, projectDir] = process.argv;
if (command && projectDir) {
  if (command === 'generate') {
    const { written } = generateInto(projectDir);
    for (const path of written) console.log(`записано: ${path}`);
  } else if (command === 'check') {
    const { ok, stale } = checkDrift(projectDir);
    if (!ok) {
      for (const path of stale) console.error(`устарело: ${path}`);
      process.exit(1);
    }
    console.log('артефакты соответствуют конфигу');
  } else {
    console.error(`неизвестная команда: ${command} (доступны: generate, check)`);
    process.exit(2);
  }
}
```

- [ ] **Step 4: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 31 тест суммарно.

- [ ] **Step 5: Проверить CLI руками на временном проекте**

Run:

```bash
mkdir -p /tmp/pl/.pipeline && printf 'version: 1\nproject:\n  name: t\n  stack: node-ts\n  goal: g\nautonomy: full\nstage: sketch\nchecks:\n  test: echo ok\nrequired: [test]\n' > /tmp/pl/.pipeline/config.yml && node src/cli.mjs generate /tmp/pl && node src/cli.mjs check /tmp/pl && sh /tmp/pl/scripts/pipeline.sh test
```

Expected: две строки `записано:`, затем `артефакты соответствуют конфигу`, затем `ok`.

- [ ] **Step 6: Коммит**

```bash
git add src/cli.mjs tests/cli.test.mjs
git commit -m "feat: CLI генерации артефактов и проверки дрейфа"
```

---

### Task 5: Шаблоны — заготовка конфига и стек node-ts

**Files:**
- Create: `templates/common/config.yml.tmpl`
- Create: `templates/common/claude-settings.json`
- Create: `templates/common/hooks/pipeline-status.sh`
- Create: `templates/stacks/node-ts/Dockerfile`
- Create: `templates/stacks/node-ts/smoke.test.mjs`
- Create: `templates/stacks/node-ts/preset.json`
- Test: `tests/templates.test.mjs`

**Interfaces:**
- Consumes: `parseConfig` (Task 1) — для проверки, что заготовка после подстановки валидна
- Produces: `templates/stacks/node-ts/preset.json` со структурой `{ "checks": Record<string,string>, "required": string[] }` — используется скиллом init как источник дефолтных команд.

- [ ] **Step 1: Написать падающий тест**

`tests/templates.test.mjs`:

```js
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

test('SessionStart-хук только печатает: ни сети, ни записи, ни установки', () => {
  const hook = readFileSync('templates/common/hooks/pipeline-status.sh', 'utf8');
  for (const forbidden of ['curl', 'wget', 'npm install', 'pip install', 'git ', '>', 'rm ']) {
    assert.equal(hook.includes(forbidden), false, `хук не должен содержать ${JSON.stringify(forbidden)}`);
  }
  assert.match(hook, /echo/);
});
```

Второй тест — исполняемая формулировка правила безопасности из §9 спецификации: человек,
скачавший шаблон, исполняет этот хук автоматически при первом запуске, поэтому хук обязан быть
безобидным настолько, чтобы его не требовалось аудировать. Проверка на подстроку `>` заодно
запрещает перенаправление вывода в файл.

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `ENOENT: no such file or directory, open 'templates/common/config.yml.tmpl'`.

- [ ] **Step 3: Создать заготовку конфига**

`templates/common/config.yml.tmpl`:

```yaml
# Этот файл ведёт агент. Правки руками допустимы, но основной путь —
# сказать агенту: /pipeline:reconfigure
#
# После изменения этого файла артефакты нужно перегенерировать,
# иначе джоба drift-check в CI станет красной.
version: 1
project:
  name: {{NAME}}
  stack: {{STACK}}
  goal: "{{GOAL}}"
autonomy: {{AUTONOMY}}
stage: {{STAGE}}
checks:
  test: npm run test
  build: npm run build
required: [test]
```

- [ ] **Step 4: Создать SessionStart-хук шаблона**

`templates/common/hooks/pipeline-status.sh`:

```sh
#!/usr/bin/env sh
if [ -f .pipeline/config.yml ]; then
  echo "Пайплайн настроен. Конфиг: .pipeline/config.yml"
else
  echo "В этом проекте есть каркас пайплайна, но он не настроен: файла .pipeline/config.yml нет."
  echo "Предложи пользователю запустить /pipeline:init, чтобы развернуть пайплайн."
fi
```

`templates/common/claude-settings.json` (кладётся в проект как `.claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup|clear",
        "hooks": [
          {
            "type": "command",
            "command": "sh .claude/hooks/pipeline-status.sh",
            "async": false
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: Создать пресет и smoke-тест стека**

`templates/stacks/node-ts/preset.json`:

```json
{
  "checks": {
    "test": "npm run test",
    "lint": "npm run lint",
    "typecheck": "npx tsc --noEmit",
    "build": "npm run build"
  },
  "required": ["test"]
}
```

`templates/stacks/node-ts/smoke.test.mjs`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';

test('окружение проекта работоспособно', () => {
  assert.equal(1 + 1, 2);
});
```

`templates/stacks/node-ts/Dockerfile`:

```dockerfile
FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build --if-present

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app ./
EXPOSE 3000
CMD ["npm", "start"]
```

- [ ] **Step 6: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 37 тестов суммарно.

- [ ] **Step 7: Коммит**

```bash
git add templates tests/templates.test.mjs
git commit -m "feat: шаблон конфига, SessionStart-хук и пресет стека node-ts"
```

---

### Task 6: Скилл `pipeline-init` и слэш-команда

**Files:**
- Create: `skills/pipeline-init/SKILL.md`
- Create: `commands/pipeline-init.md`
- Test: `tests/skill-docs.test.mjs`

**Interfaces:**
- Consumes: `node src/cli.mjs generate <projectDir>` (Task 4), `templates/` (Task 5)
- Produces: скилл, который агент исполняет; тестируется на наличие обязательных шагов, а не на поведение модели.

- [ ] **Step 1: Написать падающий тест**

`tests/skill-docs.test.mjs`:

```js
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
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `ENOENT: ... 'skills/pipeline-init/SKILL.md'`.

- [ ] **Step 3: Написать скилл**

`skills/pipeline-init/SKILL.md`:

```markdown
---
name: pipeline-init
description: Use when setting up the agent pipeline in a project - разворачивает .pipeline/config.yml, генерирует CI и pipeline.sh, доводит первый PR до зелёного
---

# Развёртывание пайплайна в проекте

Init считается завершённым не когда файлы записаны, а когда CI на PR зелёный.
Записать конфиг с выдуманными командами и уйти — основной режим отказа этого скилла.

## Шаг 1. Проверка окружения (до генерации)

Три отказа, которые иначе проявятся в середине процесса:

1. `gh auth status` — токен должен иметь scope `workflow`. Без него пуш `.github/workflows/`
   отклоняется, хотя всё остальное работает.
2. Атрибуция коммитов. После первого коммита выполнить
   `gh api repos/<owner>/<repo>/commits --jq '.[0].author.login'`. Пусто или чужой аккаунт —
   предложить `git config --local user.email` с адресом
   `<id>+<login>@users.noreply.github.com`, где id берётся из `gh api user`.
3. Включены ли Actions в репозитории — иначе PR будет ждать проверок, которых никто не запустит.

Если удалённого репозитория нет — предложить `gh repo create`, спросив про приватность.
Создавать только с явного согласия человека.

## Шаг 2. Расследование

Определить самостоятельно, не спрашивая:

- стек — по `package.json` / `pyproject.toml` / `go.mod` / `pom.xml`;
- реальные команды — из раздела `scripts` в `package.json`. Не подставлять команду из пресета,
  если её нет в проекте: пресет `templates/stacks/node-ts/preset.json` даёт кандидатов, но
  попадают в конфиг только те, что действительно существуют;
- состояние репозитория — `gh repo view`;
- работоспособность проверок — прогнать их и посмотреть, что происходит.

## Шаг 3. Интервью

Спросить только то, что нельзя узнать из файлов: цель проекта, режим автономности
(`full` / `merge-gate` / `prod-gate`), хост и registry, что считается продом.

## Шаг 4. Генерация

Заполнить `templates/common/config.yml.tmpl`, записать в `.pipeline/config.yml`, затем:

    node <plugin>/src/cli.mjs generate .

Для пустого проекта скопировать `templates/stacks/node-ts/smoke.test.mjs`, чтобы CI был зелёным
до появления первой фичи.

Скопировать `templates/common/claude-settings.json` в `.claude/settings.json` проекта и
`templates/common/hooks/pipeline-status.sh` в `.claude/hooks/`, чтобы следующий человек, открывший
проект, увидел состояние пайплайна без единой команды.

## Шаг 5. Доказательство

    sh scripts/pipeline.sh all

Затем ветка, коммит, `gh pr create`, и `gh pr checks --watch`.
Скилл завершён только когда проверки зелёные. Красные — чинить, а не отчитываться об успехе.
```

- [ ] **Step 4: Написать команду**

`commands/pipeline-init.md`:

```markdown
---
description: Развернуть пайплайн в текущем проекте
---

Используй скилл pipeline-init, чтобы развернуть пайплайн в текущем проекте.
Помни: init завершён только при зелёном CI на PR, а не после записи файлов.
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 42 теста суммарно.

- [ ] **Step 6: Коммит**

```bash
git add skills commands tests/skill-docs.test.mjs
git commit -m "feat: скилл pipeline-init и слэш-команда"
```

---

### Task 7: Манифесты плагина и marketplace

**Files:**
- Create: `.claude-plugin/plugin.json`
- Create: `.claude-plugin/marketplace.json`
- Create: `README.md`
- Test: `tests/manifests.test.mjs`

**Interfaces:**
- Consumes: `skills/`, `commands/` (Task 6)
- Produces: устанавливаемый плагин; имя плагина `pipeline` фиксируется здесь и используется в путях команд `/pipeline:init`.

- [ ] **Step 1: Написать падающий тест**

`tests/manifests.test.mjs`:

```js
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
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npm test`
Expected: FAIL — `ENOENT: ... '.claude-plugin/plugin.json'`.

- [ ] **Step 3: Создать манифесты**

`.claude-plugin/plugin.json`:

```json
{
  "name": "pipeline",
  "description": "Агентный пайплайн: промпт → код → тесты → PR → CI → merge → деплой",
  "version": "0.1.0",
  "author": { "name": "thetaDEM" },
  "repository": "https://github.com/DEMest/agent-pipeline",
  "keywords": ["ci", "cd", "pipeline", "automation"]
}
```

`.claude-plugin/marketplace.json`:

```json
{
  "name": "agent-pipeline",
  "description": "Marketplace агентного пайплайна",
  "owner": { "name": "thetaDEM" },
  "plugins": [
    {
      "name": "pipeline",
      "description": "Агентный пайплайн: промпт → код → тесты → PR → CI → merge → деплой",
      "version": "0.1.0",
      "source": "./"
    }
  ]
}
```

- [ ] **Step 4: Написать README**

`README.md`:

```markdown
# Agent Pipeline

Каркас, который разворачивает в проекте цикл: промпт → код → тесты → PR → CI → merge → деплой.

## Установка

    /plugin marketplace add DEMest/agent-pipeline

## Настройка

Настройкой занимается агент, а не вы. В папке проекта:

    /pipeline:init

Он определит стек, снимет реальные команды проверок с проекта, задаст недостающие вопросы,
сгенерирует `.github/workflows/ci.yml` и `scripts/pipeline.sh`, откроет PR и доведёт его до
зелёного CI.

## Что появляется в проекте

| Файл | Назначение |
|---|---|
| `.pipeline/config.yml` | единственный источник правды, ведёт агент |
| `.github/workflows/ci.yml` | сгенерирован, не править руками |
| `scripts/pipeline.sh` | те же команды локально, что и в CI |

CI не зависит от плагина: проект собирается и тестируется, даже если плагин не установлен.

## Разработка

    npm install
    npm test
```

- [ ] **Step 5: Убедиться, что тесты проходят**

Run: `npm test`
Expected: PASS, 47 тестов суммарно.

- [ ] **Step 6: Проверить установку плагина вручную**

Run: `/plugin marketplace add DEMest/agent-pipeline`, затем в новой сессии проверить, что команда `/pipeline:init` доступна.
Expected: плагин установлен, команда видна.

- [ ] **Step 7: Коммит**

```bash
git add .claude-plugin README.md tests/manifests.test.mjs
git commit -m "feat: манифесты плагина и marketplace, README"
```

---

### Task 8: Догфудинг — репозиторий живёт по своему пайплайну

**Files:**
- Create: `.pipeline/config.yml`
- Create: `.github/workflows/ci.yml` (сгенерирован)
- Create: `scripts/pipeline.sh` (сгенерирован)
- Test: сам CI на PR

**Interfaces:**
- Consumes: всё предыдущее
- Produces: зелёный CI на репозитории `agent-pipeline`, подтверждающий, что генератор работает на настоящем GitHub Actions, а не только в юнит-тестах.

- [ ] **Step 1: Написать конфиг для самого репозитория**

`.pipeline/config.yml`:

```yaml
# Этот файл ведёт агент. Правки руками допустимы, но основной путь —
# сказать агенту: /pipeline:reconfigure
version: 1
project:
  name: agent-pipeline
  stack: node-ts
  goal: "Каркас агентного пайплайна: генератор, плагин, шаблоны"
autonomy: merge-gate
stage: shaping
checks:
  test: npm test
required: [test]
```

- [ ] **Step 2: Сгенерировать артефакты для себя**

Run: `node src/cli.mjs generate .`
Expected: две строки `записано:` с путями `scripts/pipeline.sh` и `.github/workflows/ci.yml`.

- [ ] **Step 3: Проверить локально**

Run: `node src/cli.mjs check . && sh scripts/pipeline.sh all`
Expected: `артефакты соответствуют конфигу`, затем зелёный прогон тестов.

- [ ] **Step 4: Убедиться, что артефакты записаны с LF**

Run: `file scripts/pipeline.sh`
Expected: вывод не содержит `CRLF`. Если содержит — проверить `.gitattributes` из Task 1.

- [ ] **Step 5: Открыть PR**

```bash
git checkout -b feat/dogfood-pipeline
git add .pipeline .github scripts
git commit -m "ci: репозиторий переведён на собственный пайплайн"
git push -u origin feat/dogfood-pipeline
gh pr create --title "Репозиторий на собственном пайплайне" --body "Генератор применён к самому agent-pipeline: конфиг, CI и pipeline.sh сгенерированы им же. Проверено: npm test зелёный локально, drift-check проходит."
```

- [ ] **Step 6: Дождаться зелёного CI**

Run: `gh pr checks --watch`
Expected: обе джобы (`drift-check`, `checks`) зелёные.

- [ ] **Step 7: Проверить, что drift-check действительно ловит расхождение**

```bash
printf '\n# намеренная правка для проверки drift-check\n' >> .pipeline/config.yml
git add .pipeline/config.yml
git commit -m "test: намеренный дрейф для проверки drift-check"
git push
gh pr checks --watch
```

Expected: джоба `drift-check` красная с сообщением `артефакт не соответствует .pipeline/config.yml`.

- [ ] **Step 8: Снять дрейф и подтвердить возврат к зелёному**

```bash
node src/cli.mjs generate .
git add .pipeline .github scripts
git commit -m "ci: перегенерация артефактов после правки конфига"
git push
gh pr checks --watch
```

Expected: все джобы зелёные.

- [ ] **Step 9: Смерджить**

```bash
gh pr merge --squash
```

Expected: PR смерджен, main зелёный.

---

## Проверка готовности плана

По завершении всех восьми задач должно выполняться:

- `npm test` в репозитории зелёный, 47 тестов;
- `/plugin marketplace add DEMest/agent-pipeline` устанавливает плагин, `/pipeline:init` доступна;
- в пустой папке node-ts проекта init доводит до зелёного CI за один проход;
- намеренная правка конфига без перегенерации делает CI красным, перегенерация возвращает зелёный;
- репозиторий `agent-pipeline` собирается своим же сгенерированным workflow.

## Что осознанно отложено

Проверено по разделам спецификации, чтобы отложенное было отложенным решением, а не забытым:

| Раздел спецификации | План |
|---|---|
| §7 цикл итерации, `ship` и `ci-doctor` | план 2 |
| §8 деплой на VPS, healthcheck, откат, бэкап перед миграцией | план 3 |
| §6 стадии, `state.json`, храповик, `baseline.json`, скилл `evolve` | план 4 |
| §9 хуки `PreToolUse`: блок push в main, отказ коммитить секреты, запрет `--force` | план 4 — они зависят от стадии проекта, которой в этом плане ещё нет |
| §10 матричные тесты шаблона на четырёх стеках | план 5 — сейчас стек один, матрица вырождается в догфудинг из Task 8 |
| §4 секция `deploy` в конфиге | валидатор её пропускает как необязательную; строгая проверка появится в плане 3 вместе с потребителем |
