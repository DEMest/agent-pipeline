import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Расширения, по которым считаются «файлы исходников». Конфиги, шаблоны и
// документация сюда не входят: проект из сорока markdown-файлов не стал сложнее.
const SOURCE_EXTENSIONS = {
  'node-ts': ['.ts', '.tsx', '.js', '.mjs', '.jsx'],
  python: ['.py'],
  go: ['.go'],
  java: ['.java', '.kt'],
};

function git(projectDir, args, fallback) {
  try {
    return execFileSync('git', args, { cwd: projectDir, encoding: 'utf8' }).trim();
  } catch {
    // Проект может быть ещё не под git — это не повод падать, просто метрики
    // истории будут нулевыми.
    return fallback;
  }
}

function countDirectDeps(projectDir, stack) {
  const read = (name) => {
    const path = join(projectDir, name);
    return existsSync(path) ? readFileSync(path, 'utf8') : null;
  };

  if (stack === 'node-ts') {
    const pkg = read('package.json');
    if (!pkg) return 0;
    const parsed = JSON.parse(pkg);
    // Считаются только прямые зависимости: транзитивные к сложности проекта
    // отношения не имеют, их приносит с собой чужой выбор.
    return Object.keys({ ...parsed.dependencies, ...parsed.devDependencies }).length;
  }
  if (stack === 'python') {
    const req = read('requirements.txt');
    if (req) return req.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length;
    const toml = read('pyproject.toml');
    if (!toml) return 0;
    const block = toml.match(/dependencies\s*=\s*\[([^\]]*)\]/);
    return block ? block[1].split(',').filter((l) => l.trim()).length : 0;
  }
  if (stack === 'go') {
    const mod = read('go.mod');
    if (!mod) return 0;
    const block = mod.match(/require\s*\(([\s\S]*?)\)/);
    if (block) return block[1].split('\n').filter((l) => l.trim() && !l.trim().startsWith('//')).length;
    return (mod.match(/^require /gm) ?? []).length;
  }
  if (stack === 'java') {
    const pom = read('pom.xml');
    if (pom) return (pom.match(/<dependency>/g) ?? []).length;
    const gradle = read('build.gradle') ?? read('build.gradle.kts');
    if (!gradle) return 0;
    return (gradle.match(/^\s*(implementation|api|testImplementation|runtimeOnly)\s/gm) ?? []).length;
  }
  return 0;
}

export function collectMetrics(projectDir, config, state = {}) {
  const stack = config.project.stack;
  const extensions = SOURCE_EXTENSIONS[stack] ?? [];

  const tracked = git(projectDir, ['ls-files'], '').split('\n').filter(Boolean);
  const sources = tracked.filter((f) => extensions.some((ext) => f.endsWith(ext)));

  let loc = 0;
  for (const file of sources) {
    const path = join(projectDir, file);
    if (!existsSync(path)) continue;
    loc += readFileSync(path, 'utf8').split('\n').length;
  }

  const commitsRaw = git(projectDir, ['rev-list', '--count', 'HEAD'], '0');
  const authors = git(projectDir, ['log', '--format=%ae'], '').split('\n').filter(Boolean);
  const firstCommitTs = git(projectDir, ['log', '--reverse', '--format=%ct'], '').split('\n')[0];

  const ageDays = firstCommitTs
    ? Math.floor((Date.now() / 1000 - Number(firstCommitTs)) / 86400)
    : 0;

  return {
    sourceFiles: sources.length,
    loc,
    directDeps: countDirectDeps(projectDir, stack),
    commits: Number(commitsRaw) || 0,
    contributors: new Set(authors).size,
    ageDays,
    hasProductionEnv: Boolean(config.deploy?.environments?.production),
    // Сигналы боли не выводятся из файлов: их записывает агент, когда что-то
    // пошло не так — откатили прод, второй раз сломалось то же место.
    painSignals: state.painSignals ?? [],
  };
}
