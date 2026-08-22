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

test('нереализованный стек отвергается явной ошибкой', () => {
  const cfg = { ...CFG, project: { ...CFG.project, stack: 'go' } };
  assert.throws(() => generateCi(cfg, HASH), (e) => e instanceof UnsupportedStackError && e.stackName === 'go');
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
