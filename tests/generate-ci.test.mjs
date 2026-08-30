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
  assert.match(script, /\.pipeline\/config\.yml.*sha256sum/);
  assert.match(script, /generated-from-config/);
});

test('drift-check считает хеш конфига нечувствительно к CR, чтобы не краснеть на Windows-клоне', () => {
  const doc = parseYaml(generateCi(CFG, HASH));
  const script = doc.jobs['drift-check'].steps.map((s) => s.run ?? '').join('\n');
  assert.match(script, /tr -d '\\r' < \.pipeline\/config\.yml \| sha256sum/);
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

test('стек без реализации в генераторе отвергается явной ошибкой', () => {
  // Валидатор конфига и генератор — разные списки стеков. Если стек добавят
  // в валидатор и забудут в генераторе, без этой проверки пользователь получил бы
  // невнятный сбой вместо сообщения о том, что стек не поддерживается.
  const cfg = { ...CFG, project: { ...CFG.project, stack: 'rust' } };
  assert.throws(() => generateCi(cfg, HASH), (e) => e instanceof UnsupportedStackError && e.stackName === 'rust');
});

test('каждый стек, который принимает конфиг, умеет генерировать CI', () => {
  // Страж рассинхрона между STACKS в конфиге и setupSteps в генераторе:
  // добавили стек в один список, забыли в другом — тест краснеет здесь,
  // а не у пользователя на его проекте.
  const byStack = {
    'node-ts': { name: 'a', stack: 'node-ts', goal: 'g' },
    java: { name: 'a', stack: 'java', build: 'maven', goal: 'g' },
    python: { name: 'a', stack: 'python', build: 'pip', goal: 'g' },
    go: { name: 'a', stack: 'go', goal: 'g' },
  };
  for (const [stack, project] of Object.entries(byStack)) {
    const cfg = { ...CFG, project, checks: { test: 'x' }, required: ['test'] };
    assert.doesNotThrow(() => generateCi(cfg, HASH), `стек ${stack} не генерируется`);
  }
});

const javaConfig = (build, extra = {}) => ({
  ...CFG,
  project: { name: 'my-app', stack: 'java', build, goal: 'g', ...extra },
  checks: { test: build === 'gradle' ? './gradlew test' : './mvnw -B test' },
  required: ['test'],
});

for (const build of ['maven', 'gradle']) {
  test(`для java/${build} ставится JDK`, () => {
    const doc = parseYaml(generateCi(javaConfig(build), HASH));
    const setup = doc.jobs.checks.steps.find((s) => s.uses?.startsWith('actions/setup-java@'));
    assert.ok(setup, 'нет шага установки JDK');
    assert.equal(setup.with.distribution, 'temurin');
  });

  test(`для java/${build} кэшируется своя система сборки`, () => {
    // Подсказка не той системе не кэширует ничего: maven и gradle держат
    // зависимости в разных каталогах.
    const doc = parseYaml(generateCi(javaConfig(build), HASH));
    const setup = doc.jobs.checks.steps.find((s) => s.uses?.startsWith('actions/setup-java@'));
    assert.equal(setup.with.cache, build);
  });

  test(`для java/${build} обёртке сборки возвращается право на запуск`, () => {
    // Флаг исполняемости теряется, если файл добавили с Windows или через веб-интерфейс,
    // и CI падает на первом же шаге с Permission denied.
    const doc = parseYaml(generateCi(javaConfig(build), HASH));
    const wrapper = build === 'gradle' ? 'gradlew' : 'mvnw';
    const step = doc.jobs.checks.steps.find((s) => s.name?.includes(wrapper));
    assert.ok(step, `нет шага chmod для ./${wrapper}`);
    assert.ok(step.run.includes(`chmod +x ./${wrapper}`), `шаг не возвращает право на запуск: ${step.run}`);
  });
}

test('версия JDK по умолчанию 21 — Spring Boot 3 требует 17 и новее', () => {
  const doc = parseYaml(generateCi(javaConfig('maven'), HASH));
  const setup = doc.jobs.checks.steps.find((s) => s.uses?.startsWith('actions/setup-java@'));
  assert.equal(setup.with['java-version'], '21');
});

test('проект может назвать свою версию JDK', () => {
  const doc = parseYaml(generateCi(javaConfig('maven', { java_version: '17' }), HASH));
  const setup = doc.jobs.checks.steps.find((s) => s.uses?.startsWith('actions/setup-java@'));
  assert.equal(setup.with['java-version'], '17');
});

test('java не тянет за собой установку Node', () => {
  const doc = parseYaml(generateCi(javaConfig('maven'), HASH));
  assert.equal(doc.jobs.checks.steps.some((s) => s.uses?.startsWith('actions/setup-node@')), false);
  assert.equal(doc.jobs.checks.steps.some((s) => s.run === 'npm ci'), false);
});

const pyConfig = (build, extra = {}) => ({
  ...CFG,
  project: { name: 'my-app', stack: 'python', build, goal: 'g', ...extra },
  checks: { test: 'python -m pytest' },
  required: ['test'],
});

for (const build of ['pip', 'poetry', 'uv']) {
  test(`для python/${build} ставится интерпретатор и зависимости`, () => {
    const doc = parseYaml(generateCi(pyConfig(build), HASH));
    const setup = doc.jobs.checks.steps.find((s) => s.uses?.startsWith('actions/setup-python@'));
    assert.ok(setup, 'нет шага установки python');
    const install = doc.jobs.checks.steps.find((s) => s.name === 'Поставить зависимости');
    assert.ok(install, 'нет шага установки зависимостей');
  });
}

test('кэш зависимостей python соответствует менеджеру', () => {
  const cacheOf = (build) => parseYaml(generateCi(pyConfig(build), HASH))
    .jobs.checks.steps.find((s) => s.uses?.startsWith('actions/setup-python@')).with.cache;
  assert.equal(cacheOf('pip'), 'pip');
  assert.equal(cacheOf('poetry'), 'poetry');
  // setup-python не знает про uv: указать ему несуществующий менеджер значит
  // получить ошибку шага, а не кэш. uv кэширует сам.
  assert.equal(cacheOf('uv'), undefined);
});

test('poetry ставится раньше setup-python, иначе кэшировать нечего', () => {
  const steps = parseYaml(generateCi(pyConfig('poetry'), HASH)).jobs.checks.steps;
  const poetryIndex = steps.findIndex((s) => s.name === 'Установить poetry');
  const setupIndex = steps.findIndex((s) => s.uses?.startsWith('actions/setup-python@'));
  assert.notEqual(poetryIndex, -1);
  assert.ok(poetryIndex < setupIndex, 'poetry должен ставиться до setup-python');
});

test('установка зависимостей pip не глушит ошибку установки', () => {
  // Отсутствие requirements.txt — норма, а вот упавшая установка обязана уронить
  // шаг. Поэтому проверка файла через if, а не "|| true", который скрыл бы сбой.
  const install = parseYaml(generateCi(pyConfig('pip'), HASH))
    .jobs.checks.steps.find((s) => s.name === 'Поставить зависимости').run;
  assert.match(install, /if \[ -f requirements\.txt \]/);
  assert.equal(install.includes('|| true'), false);
});

test('версия python берётся из конфига, иначе 3.12', () => {
  const versionOf = (project) => parseYaml(generateCi(pyConfig('pip', project), HASH))
    .jobs.checks.steps.find((s) => s.uses?.startsWith('actions/setup-python@')).with['python-version'];
  assert.equal(versionOf({}), '3.12');
  assert.equal(versionOf({ python_version: '3.11' }), '3.11');
});

const goConfig = (extra = {}) => ({
  ...CFG,
  project: { name: 'my-app', stack: 'go', goal: 'g', ...extra },
  checks: { test: 'go test ./...' },
  required: ['test'],
});

test('для go включён кэш модулей и скачиваются зависимости', () => {
  const steps = parseYaml(generateCi(goConfig(), HASH)).jobs.checks.steps;
  const setup = steps.find((s) => s.uses?.startsWith('actions/setup-go@'));
  assert.ok(setup, 'нет шага установки go');
  assert.equal(setup.with.cache, true);
  assert.ok(steps.some((s) => s.run === 'go mod download'));
});

test('версия go по умолчанию stable, но проект может назвать свою', () => {
  const versionOf = (project) => parseYaml(generateCi(goConfig(project), HASH))
    .jobs.checks.steps.find((s) => s.uses?.startsWith('actions/setup-go@')).with['go-version'];
  assert.equal(versionOf({}), 'stable');
  assert.equal(versionOf({ go_version: '1.23' }), '1.23');
});

test('python и go не тянут за собой чужие рантаймы', () => {
  for (const cfg of [pyConfig('pip'), goConfig()]) {
    const uses = parseYaml(generateCi(cfg, HASH)).jobs.checks.steps.map((s) => s.uses).filter(Boolean);
    assert.equal(uses.some((u) => u.startsWith('actions/setup-node@')), false);
    assert.equal(uses.some((u) => u.startsWith('actions/setup-java@')), false);
  }
});
