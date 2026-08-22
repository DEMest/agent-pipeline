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

test('отвергает проверку с зарезервированным именем all', () => {
  const bad = VALID.replace('  lint: npm run lint', '  all: npm run all');
  assert.throws(() => parseConfig(bad), (e) => e instanceof ConfigError && e.field === 'checks');
});

test('отвергает проверку с зарезервированным именем esac', () => {
  const bad = VALID.replace('  lint: npm run lint', '  esac: npm run esac');
  assert.throws(() => parseConfig(bad), (e) => e instanceof ConfigError && e.field === 'checks');
});

test('объясняет причину запрета отдельно для каждого зарезервированного имени', () => {
  const reasonFor = (name) => {
    const bad = VALID.replace('  lint: npm run lint', `  ${name}: npm run x`);
    try {
      parseConfig(bad);
      throw new Error(`имя ${name} должно было быть отвергнуто`);
    } catch (e) {
      return e.message;
    }
  };
  const allReason = reasonFor('all');
  const esacReason = reasonFor('esac');
  assert.notEqual(allReason, esacReason);
  assert.match(allReason, /диспетчер/);
  assert.match(esacReason, /case/);
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
