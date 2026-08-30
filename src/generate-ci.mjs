import { stringify as stringifyYaml } from 'yaml';

export class UnsupportedStackError extends Error {
  constructor(stackName) {
    super(`стек ${stackName} пока не поддерживается генератором CI`);
    this.name = 'UnsupportedStackError';
    // Именно stackName, а не stack: у Error свойство stack — это стектрейс.
    this.stackName = stackName;
  }
}

const DEFAULT_JAVA_VERSION = '21';
const DEFAULT_PYTHON_VERSION = '3.12';
// stable вместо точной версии: go выпускает патчи часто, и прибивать их
// в шаблоне значит устаревать через месяц.
const DEFAULT_GO_VERSION = 'stable';

// Наличие файла проверяется, а результат установки — нет: отсутствие
// requirements.txt это нормально, а вот упавшая установка обязана уронить шаг,
// поэтому здесь if, а не "|| true", который проглотил бы настоящую ошибку.
const PYTHON_INSTALL = {
  pip: [
    'python -m pip install --upgrade pip',
    'if [ -f requirements.txt ]; then pip install -r requirements.txt; fi',
    'if [ -f requirements-dev.txt ]; then pip install -r requirements-dev.txt; fi',
    'if [ -f pyproject.toml ]; then pip install -e .; fi',
  ].join('\n'),
  poetry: 'poetry install --no-interaction',
  uv: [
    'python -m pip install uv',
    'uv sync',
  ].join('\n'),
};

// Обёртка сборки лежит в репозитории, но флаг исполняемости часто теряется —
// файл добавляют с Windows или через веб-интерфейс, и в CI получается
// «Permission denied» на первом же шаге. chmod дешевле, чем разбираться потом.
const wrapperChmod = (wrapper) => ({
  name: `Разрешить запуск ${wrapper}`,
  run: `test -f ./${wrapper} && chmod +x ./${wrapper} || echo "обёртки ./${wrapper} нет, используется системная установка"`,
});

function setupSteps(project) {
  if (project.stack === 'node-ts') {
    return [
      { uses: 'actions/setup-node@v4', with: { 'node-version': '24', cache: 'npm' } },
      { run: 'npm ci' },
    ];
  }
  if (project.stack === 'java') {
    // Кэш зависит от системы сборки: maven и gradle хранят зависимости в разных
    // местах, и подсказка не той системе просто не кэширует ничего.
    const cache = project.build === 'gradle' ? 'gradle' : 'maven';
    return [
      {
        uses: 'actions/setup-java@v4',
        with: {
          distribution: 'temurin',
          'java-version': project.java_version ?? DEFAULT_JAVA_VERSION,
          cache,
        },
      },
      wrapperChmod(project.build === 'gradle' ? 'gradlew' : 'mvnw'),
    ];
  }
  if (project.stack === 'python') {
    const steps = [];
    // poetry ставится до setup-python: с cache: poetry действие ищет уже
    // существующий poetry, чтобы понять, что и откуда кэшировать.
    if (project.build === 'poetry') {
      steps.push({ name: 'Установить poetry', run: 'pipx install poetry' });
    }
    const cache = { pip: 'pip', poetry: 'poetry' }[project.build];
    steps.push({
      uses: 'actions/setup-python@v5',
      with: {
        'python-version': project.python_version ?? DEFAULT_PYTHON_VERSION,
        // uv кэширует зависимости сам, и setup-python про него не знает.
        ...(cache ? { cache } : {}),
      },
    });
    steps.push({ name: 'Поставить зависимости', run: PYTHON_INSTALL[project.build] });
    return steps;
  }
  if (project.stack === 'go') {
    return [
      {
        uses: 'actions/setup-go@v5',
        // Кэш модулей и сборки включён по умолчанию, но пишем явно: без него
        // каждый прогон заново тянет весь граф зависимостей.
        with: { 'go-version': project.go_version ?? DEFAULT_GO_VERSION, cache: true },
      },
      { name: 'Скачать зависимости', run: 'go mod download' },
    ];
  }
  return null;
}

const DRIFT_SCRIPT = [
  // tr -d '\r' убирает CR перед хешированием: на Windows-клоне .gitattributes отдаёт
  // .pipeline/config.yml с CRLF, а голый sha256sum хеширует байты файла как есть — тот же
  // конфиг давал бы разный хеш только из-за перевода строк. configHash в src/config.mjs
  // нормализует CRLF к LF тем же способом, поэтому оба хеша совпадают.
  'expected=$(tr -d \'\\r\' < .pipeline/config.yml | sha256sum | cut -d " " -f 1)',
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
  const setup = setupSteps(config.project);
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
