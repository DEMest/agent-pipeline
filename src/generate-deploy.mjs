import { stringify as stringifyYaml } from 'yaml';

// Тег образа — commit SHA. На откате любая более хитрая схема версионирования
// только мешает: нужно быстро назвать предыдущее заведомо рабочее состояние.
const IMAGE_TAG = '${{ github.sha }}';

function sshSetup() {
  return [
    'mkdir -p ~/.ssh && chmod 700 ~/.ssh',
    'printf "%s\\n" "$SSH_KEY" > ~/.ssh/id_deploy',
    'chmod 600 ~/.ssh/id_deploy',
    // Отпечаток хоста берётся при подключении. Это доверие при первом контакте:
    // защищает от пассивного прослушивания, но не от подмены хоста в момент
    // первого деплоя. Строгий вариант — положить известный отпечаток в секрет
    // и записать его сюда вместо ssh-keyscan.
    'ssh-keyscan -H "$DEPLOY_HOST" >> ~/.ssh/known_hosts 2>/dev/null',
  ].join('\n');
}

function remoteDeploy(project) {
  // Предыдущий тег сохраняется на сервере перед сменой: без него откат
  // не на что опереть, а угадывать «предыдущий» по registry ненадёжно.
  return [
    'ssh -i ~/.ssh/id_deploy "$DEPLOY_HOST" bash -s <<REMOTE',
    'set -eu',
    `mkdir -p ~/.pipeline/${project}`,
    `if [ -f ~/.pipeline/${project}/current ]; then`,
    `  cp ~/.pipeline/${project}/current ~/.pipeline/${project}/previous`,
    'fi',
    `echo "$IMAGE" > ~/.pipeline/${project}/current`,
    `cd ~/.pipeline/${project}`,
    'IMAGE="$IMAGE" docker compose pull',
    'IMAGE="$IMAGE" docker compose up -d',
    'REMOTE',
  ].join('\n');
}

function healthcheckStep(healthcheck) {
  const { timeout_sec: timeout } = healthcheck;
  return [
    'deadline=$(( $(date +%s) + ' + timeout + ' ))',
    'until curl -fsS "${HEALTHCHECK_URL}" >/dev/null 2>&1; do',
    '  if [ "$(date +%s)" -ge "$deadline" ]; then',
    '    echo "::error::healthcheck не ответил за ' + timeout + ' секунд"',
    '    exit 1',
    '  fi',
    '  sleep 3',
    'done',
    'echo "healthcheck прошёл"',
  ].join('\n');
}

function rollbackStep(project) {
  return [
    'ssh -i ~/.ssh/id_deploy "$DEPLOY_HOST" bash -s <<REMOTE',
    'set -eu',
    `cd ~/.pipeline/${project}`,
    'if [ ! -f previous ]; then',
    '  echo "::error::откатываться некуда: предыдущего образа нет"',
    '  exit 1',
    'fi',
    'PREV=$(cat previous)',
    'IMAGE="$PREV" docker compose up -d',
    'cp previous current',
    'echo "откат на $PREV выполнен"',
    'REMOTE',
  ].join('\n');
}

function environmentJob(envName, env, config, image) {
  const project = config.project.name;
  const steps = [
    { uses: 'actions/checkout@v4' },
    {
      name: 'Подготовить доступ по SSH',
      env: { SSH_KEY: '${{ secrets.SSH_KEY }}', DEPLOY_HOST: env.host },
      run: sshSetup(),
    },
    {
      // compose.yml живёт в репозитории проекта и копируется на сервер при каждой
      // выкатке. Иначе `docker compose up` на сервере запускать нечего, а версия
      // на сервере незаметно расходилась бы с той, что в репозитории.
      name: 'Скопировать compose на сервер',
      env: { DEPLOY_HOST: env.host },
      run: [
        `ssh -i ~/.ssh/id_deploy "$DEPLOY_HOST" "mkdir -p ~/.pipeline/${project}"`,
        `scp -i ~/.ssh/id_deploy deploy/compose.yml "$DEPLOY_HOST:~/.pipeline/${project}/compose.yml"`,
      ].join('\n'),
    },
    {
      name: 'Выкатить образ',
      env: { DEPLOY_HOST: env.host, IMAGE: image },
      run: remoteDeploy(project),
    },
    {
      name: 'Проверить healthcheck',
      id: 'healthcheck',
      env: { HEALTHCHECK_URL: env.url + config.deploy.healthcheck.path },
      run: healthcheckStep(config.deploy.healthcheck),
    },
    {
      name: 'Откатиться, healthcheck не прошёл',
      if: 'failure() && steps.healthcheck.conclusion == \'failure\'',
      env: { DEPLOY_HOST: env.host },
      run: rollbackStep(project),
    },
    {
      name: 'Завести issue о провале выкатки',
      if: 'failure()',
      env: { GH_TOKEN: '${{ secrets.GITHUB_TOKEN }}' },
      run: `gh issue create --title "Выкатка на ${envName} провалилась" `
        + `--body "Коммит ${IMAGE_TAG} не прошёл healthcheck на ${env.host}. `
        + `Выполнен откат на предыдущий образ. Прогон: \${{ github.server_url }}/\${{ github.repository }}/actions/runs/\${{ github.run_id }}"`,
    },
  ];

  return {
    'runs-on': 'ubuntu-latest',
    // Имя окружения включает защиту GitHub Environments: для окружения с auto: false
    // в настройках репозитория назначаются проверяющие, и джоба ждёт их одобрения.
    environment: envName,
    permissions: { contents: 'read', issues: 'write' },
    steps,
  };
}

export function generateDeploy(config, hash) {
  const deploy = config.deploy;
  if (!deploy) return null;

  const image = `${deploy.registry}:${IMAGE_TAG}`;
  const jobs = {
    build: {
      'runs-on': 'ubuntu-latest',
      permissions: { contents: 'read', packages: 'write' },
      steps: [
        { uses: 'actions/checkout@v4' },
        {
          name: 'Войти в registry',
          run: 'echo "$REGISTRY_TOKEN" | docker login ghcr.io -u "${{ github.actor }}" --password-stdin',
          env: { REGISTRY_TOKEN: '${{ secrets.REGISTRY_TOKEN }}' },
        },
        { name: 'Собрать и запушить образ', run: `docker build -t ${image} .\ndocker push ${image}` },
      ],
    },
  };

  // Окружения с auto: true выкатываются сразу после сборки. Окружения с auto: false
  // ждут одобрения человека — за это отвечает защита окружения на стороне GitHub,
  // поэтому джоба создаётся одинаково, а различие живёт в настройках репозитория.
  const autoEnvs = Object.entries(deploy.environments).filter(([, env]) => env.auto);
  const gatedEnvs = Object.entries(deploy.environments).filter(([, env]) => !env.auto);

  for (const [name, env] of autoEnvs) {
    jobs[`deploy-${name}`] = { needs: 'build', ...environmentJob(name, env, config, image) };
  }
  for (const [name, env] of gatedEnvs) {
    const needs = ['build', ...autoEnvs.map(([autoName]) => `deploy-${autoName}`)];
    jobs[`deploy-${name}`] = { needs, ...environmentJob(name, env, config, image) };
  }

  const workflow = {
    name: 'Deploy',
    on: { push: { branches: ['main'] } },
    jobs,
  };

  return `# generated-from-config: sha256:${hash}\n`
    + '# Файл сгенерирован из .pipeline/config.yml. Правки затрутся при следующей генерации.\n'
    + stringifyYaml(workflow, { lineWidth: 0 });
}
