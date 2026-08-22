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
