import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

const STACKS = ['node-ts', 'python', 'go', 'java'];
const AUTONOMY = ['full', 'merge-gate', 'prod-gate'];
const STAGES = ['sketch', 'shaping', 'product', 'sustained'];
// Имена проверок становятся именами функций в sh и ключами диспетчера case.
// Два имени зарезервированы: 'all' совпадает с агрегатной веткой диспетчера,
// 'esac' закрывает конструкцию case и ломает разбор всего скрипта.
const CHECK_NAME = /^[a-z][a-z0-9_]*$/;
// Причина запрета у каждого имени своя, поэтому она хранится рядом с ним:
// разработчик, увидевший ошибку, должен понять, почему имя нельзя взять.
// Остальные ключевые слова sh в позиции шаблона case безопасны — проверено запуском.
const RESERVED_CHECK_NAMES = {
  all: 'оно совпадает с агрегатной веткой диспетчера, запускающей все проверки сразу',
  esac: 'оно закрывает конструкцию case и ломает разбор всего скрипта',
};

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
    if (Object.hasOwn(RESERVED_CHECK_NAMES, name)) {
      throw new ConfigError(`checks: имя ${JSON.stringify(name)} нельзя использовать — ${RESERVED_CHECK_NAMES[name]}`, 'checks');
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
