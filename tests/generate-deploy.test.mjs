import test from 'node:test';
import assert from 'node:assert/strict';
import { parse as parseYaml } from 'yaml';
import { generateDeploy } from '../src/generate-deploy.mjs';

const HASH = 'd'.repeat(64);

const CONFIG = {
  version: 1,
  project: { name: 'my-app', stack: 'node-ts', goal: 'g' },
  autonomy: 'prod-gate',
  stage: 'product',
  checks: { test: 'npm test' },
  required: ['test'],
  deploy: {
    target: 'docker-vps',
    registry: 'ghcr.io/owner/my-app',
    environments: {
      staging: { host: 'deploy@staging.example.com', url: 'https://staging.example.com', auto: true },
      production: { host: 'deploy@example.com', url: 'https://example.com', auto: false },
    },
    healthcheck: { path: '/healthz', timeout_sec: 60 },
    secrets: ['SSH_KEY', 'REGISTRY_TOKEN'],
  },
};

const doc = () => parseYaml(generateDeploy(CONFIG, HASH));

test('без секции deploy ничего не генерируется', () => {
  const { deploy, ...withoutDeploy } = CONFIG;
  assert.equal(generateDeploy(withoutDeploy, HASH), null);
});

test('первая строка — маркер хеша конфига', () => {
  assert.equal(generateDeploy(CONFIG, HASH).split('\n')[0], `# generated-from-config: sha256:${HASH}`);
});

test('на каждое окружение своя джоба плюс сборка', () => {
  assert.deepEqual(Object.keys(doc().jobs).sort(), ['build', 'deploy-production', 'deploy-staging']);
});

test('образ тегируется commit SHA, а не плавающим тегом', () => {
  const build = doc().jobs.build.steps.find((s) => s.name === 'Собрать и запушить образ');
  assert.match(build.run, /ghcr\.io\/owner\/my-app:\$\{\{ github\.sha \}\}/);
  assert.equal(/:latest/.test(build.run), false);
});

test('окружение с auto true выкатывается сразу после сборки', () => {
  assert.equal(doc().jobs['deploy-staging'].needs, 'build');
});

test('окружение с auto false ждёт автоматических окружений', () => {
  assert.deepEqual(doc().jobs['deploy-production'].needs, ['build', 'deploy-staging']);
});

test('джоба привязана к окружению GitHub — через него включается ручное одобрение', () => {
  assert.equal(doc().jobs['deploy-production'].environment, 'production');
  assert.equal(doc().jobs['deploy-staging'].environment, 'staging');
});

test('healthcheck опрашивает адрес окружения, а не хост ssh', () => {
  // Адрес проверки и назначение ssh — разные вещи: сервис может слушать другой
  // домен, схему или порт, а ssh-хост включает пользователя и для http бесполезен.
  const staging = doc().jobs['deploy-staging'].steps.find((s) => s.id === 'healthcheck');
  assert.equal(staging.env.HEALTHCHECK_URL, 'https://staging.example.com/healthz');
  const production = doc().jobs['deploy-production'].steps.find((s) => s.id === 'healthcheck');
  assert.equal(production.env.HEALTHCHECK_URL, 'https://example.com/healthz');
});

test('healthcheck ждёт столько секунд, сколько указано в конфиге', () => {
  const step = doc().jobs['deploy-staging'].steps.find((s) => s.id === 'healthcheck');
  assert.match(step.run, /\+ 60 \)\)/);
});

test('ssh идёт на назначение с пользователем', () => {
  const step = doc().jobs['deploy-staging'].steps.find((s) => s.name === 'Выкатить образ');
  assert.equal(step.env.DEPLOY_HOST, 'deploy@staging.example.com');
});

test('откат срабатывает только при провале healthcheck', () => {
  const step = doc().jobs['deploy-production'].steps.find((s) => s.name?.startsWith('Откатиться'));
  assert.match(step.if, /steps\.healthcheck\.conclusion == 'failure'/);
  assert.match(step.run, /previous/);
});

test('перед сменой образа сохраняется предыдущий — иначе откатываться не на что', () => {
  const step = doc().jobs['deploy-staging'].steps.find((s) => s.name === 'Выкатить образ');
  assert.match(step.run, /cp ~\/\.pipeline\/my-app\/current ~\/\.pipeline\/my-app\/previous/);
});

test('провал выкатки заводит issue', () => {
  const step = doc().jobs['deploy-production'].steps.find((s) => s.name?.includes('issue'));
  assert.match(step.run, /gh issue create/);
  assert.equal(step.if, 'failure()');
});

test('секреты не попадают в workflow значениями — только ссылками на GitHub Secrets', () => {
  const text = generateDeploy(CONFIG, HASH);
  assert.match(text, /\$\{\{ secrets\.SSH_KEY \}\}/);
  // Приватный ключ не должен оказаться в сгенерированном файле ни при каких условиях.
  assert.equal(/BEGIN [A-Z ]*PRIVATE KEY/.test(text), false);
});

test('джобам выданы минимальные права', () => {
  const jobs = doc().jobs;
  assert.deepEqual(jobs.build.permissions, { contents: 'read', packages: 'write' });
  assert.deepEqual(jobs['deploy-staging'].permissions, { contents: 'read', issues: 'write' });
});

test('compose копируется на сервер до запуска — иначе там нечего поднимать', () => {
  const jobSteps = doc().jobs['deploy-staging'].steps;
  const copyIndex = jobSteps.findIndex((s) => s.name === 'Скопировать compose на сервер');
  const upIndex = jobSteps.findIndex((s) => s.name === 'Выкатить образ');
  assert.notEqual(copyIndex, -1, 'шага копирования compose нет');
  assert.ok(copyIndex < upIndex, 'compose должен попасть на сервер раньше запуска');
  assert.match(jobSteps[copyIndex].run, /scp .*deploy\/compose\.yml/);
});
