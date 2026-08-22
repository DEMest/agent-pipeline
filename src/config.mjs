import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

const STACKS = ['node-ts', 'python', 'go', 'java'];
const AUTONOMY = ['full', 'merge-gate', 'prod-gate'];
const STAGES = ['sketch', 'shaping', 'product', 'sustained'];
const JAVA_BUILDS = ['maven', 'gradle'];
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
// Единственные поля верхнего уровня, которые понимает конфиг. Опечатка вроде
// requred: вместо required: иначе неотличима от намеренного отсутствия поля —
// required ?? [] тихо превращал бы её в пустой список, required-check выключался
// молча, и упавший тест не мешал бы CI быть зелёным.
const KNOWN_TOP_LEVEL_KEYS = new Set(['version', 'project', 'autonomy', 'stage', 'checks', 'required', 'deploy']);
const DEPLOY_TARGETS = ['docker-vps'];
// Секреты в конфиге — только имена переменных, значения живут в GitHub Secrets.
// Конфиг коммитится, поэтому формат имени проверяется строго: настоящий токен
// почти наверняка содержит символы вне этого набора и будет отвергнут до коммита.
const SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;

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
  for (const key of Object.keys(doc)) {
    if (!KNOWN_TOP_LEVEL_KEYS.has(key)) {
      throw new ConfigError(
        `неизвестное поле верхнего уровня: ${JSON.stringify(key)} (допустимы: ${[...KNOWN_TOP_LEVEL_KEYS].join(', ')})`,
        'root',
      );
    }
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
  // У java две несовместимые системы сборки с разными командами, разным кэшем в CI
  // и разным местом сборочного артефакта. Угадывать её по содержимому checks — гадание
  // на строках, поэтому она указывается явно.
  if (project.stack === 'java') {
    requireOneOf(project.build, JAVA_BUILDS, 'project.build');
    // Версия JDK влияет и на CI, и на образ. Spring Boot 3 требует 17 и новее,
    // поэтому по умолчанию берётся 21 LTS, но проект может назвать свою.
    if (project.java_version !== undefined
        && !(typeof project.java_version === 'string' && /^[0-9]+$/.test(project.java_version))) {
      throw new ConfigError('project.java_version: ожидается строка с номером версии, например "21"', 'project.java_version');
    }
  } else if (project.build !== undefined) {
    throw new ConfigError(
      `project.build: поле имеет смысл только для стека java, а стек здесь ${JSON.stringify(project.stack)}`,
      'project.build',
    );
  }
  requireOneOf(doc.autonomy, AUTONOMY, 'autonomy');
  requireOneOf(doc.stage, STAGES, 'stage');

  const checks = doc.checks;
  if (Array.isArray(checks)) {
    // Массив тоже typeof === 'object' и не пуст, поэтому без этой проверки код
    // проваливался в цикл по Object.entries и падал позже с сообщением про
    // непригодное имя функции ("0", "1", ...) — верным, но вводящим в заблуждение
    // о настоящей причине.
    throw new ConfigError('checks: ожидается объект «имя: команда», получен список', 'checks');
  }
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

  // required обязателен и не может быть пустым: иначе отсутствие поля или опечатка
  // (requred:) молча превращались бы в пустой список, ни одна проверка не становилась
  // бы обязательной, и CI с этим конфигом физически не мог бы покраснеть даже при
  // падающих тестах — ровно противоположность назначению продукта.
  const required = doc.required;
  if (!Array.isArray(required)) {
    throw new ConfigError('required: обязательное поле, ожидается непустой список имён из checks', 'required');
  }
  if (required.length === 0) {
    throw new ConfigError('required: нужна хотя бы одна обязательная проверка', 'required');
  }
  for (const name of required) {
    if (!Object.hasOwn(checks, name)) {
      throw new ConfigError(`required: ${JSON.stringify(name)} отсутствует в checks`, 'required');
    }
  }

  validateDeploy(doc.deploy);

  return { ...doc, required };
}

// Секция deploy необязательна: проект может жить без выкатки. Но если она есть,
// проверяется строго — ошибка в ней обнаружится иначе в момент выкатки на прод,
// то есть в худшую из возможных минут.
function validateDeploy(deploy) {
  if (deploy === undefined) return;
  if (deploy === null || typeof deploy !== 'object' || Array.isArray(deploy)) {
    throw new ConfigError('deploy: ожидается объект', 'deploy');
  }

  if (!DEPLOY_TARGETS.includes(deploy.target)) {
    throw new ConfigError(
      `deploy.target: ожидалось одно из ${DEPLOY_TARGETS.join(', ')}, получено ${JSON.stringify(deploy.target)}`,
      'deploy.target',
    );
  }
  if (typeof deploy.registry !== 'string' || deploy.registry.trim() === '') {
    throw new ConfigError('deploy.registry: непустая строка обязательна', 'deploy.registry');
  }

  const environments = deploy.environments;
  if (!environments || typeof environments !== 'object' || Array.isArray(environments)
      || Object.keys(environments).length === 0) {
    throw new ConfigError('deploy.environments: нужно хотя бы одно окружение', 'deploy.environments');
  }
  for (const [name, env] of Object.entries(environments)) {
    if (!env || typeof env !== 'object' || Array.isArray(env)) {
      throw new ConfigError(`deploy.environments.${name}: ожидается объект`, 'deploy.environments');
    }
    // host — назначение для ssh, поэтому включает пользователя: без него ssh пойдёт
    // под учётной записью раннера, которой на сервере нет.
    if (typeof env.host !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(env.host)) {
      throw new ConfigError(
        `deploy.environments.${name}.host: ожидается назначение ssh вида пользователь@хост`,
        'deploy.environments',
      );
    }
    // url — то, что опрашивает healthcheck. Отдельно от host, потому что схема и порт
    // проверки не выводятся из адреса ssh: сервис может слушать http, другой порт
    // или отвечать на домене, отличном от того, куда мы ходим по ssh.
    if (typeof env.url !== 'string' || !/^https?:\/\/./.test(env.url)) {
      throw new ConfigError(
        `deploy.environments.${name}.url: ожидается адрес вида http://… или https://…`,
        'deploy.environments',
      );
    }
    // auto указывается явно: молчаливый выбор здесь означал бы выкатку на прод
    // без ведома человека либо её отсутствие там, где её ждут.
    if (typeof env.auto !== 'boolean') {
      throw new ConfigError(
        `deploy.environments.${name}.auto: нужно явное true или false`,
        'deploy.environments',
      );
    }
  }

  const healthcheck = deploy.healthcheck;
  if (!healthcheck || typeof healthcheck !== 'object' || Array.isArray(healthcheck)) {
    throw new ConfigError('deploy.healthcheck: ожидается объект с полями path и timeout_sec', 'deploy.healthcheck');
  }
  if (typeof healthcheck.path !== 'string' || !healthcheck.path.startsWith('/')) {
    throw new ConfigError('deploy.healthcheck.path: путь должен начинаться с /', 'deploy.healthcheck');
  }
  if (!Number.isInteger(healthcheck.timeout_sec) || healthcheck.timeout_sec <= 0) {
    throw new ConfigError('deploy.healthcheck.timeout_sec: нужно целое число секунд больше нуля', 'deploy.healthcheck');
  }

  if (deploy.backup_before_migrate !== undefined && typeof deploy.backup_before_migrate !== 'boolean') {
    throw new ConfigError('deploy.backup_before_migrate: ожидается true или false', 'deploy.backup_before_migrate');
  }

  const secrets = deploy.secrets ?? [];
  if (!Array.isArray(secrets)) {
    throw new ConfigError('deploy.secrets: ожидается список имён', 'deploy.secrets');
  }
  for (const name of secrets) {
    if (typeof name !== 'string' || !SECRET_NAME.test(name)) {
      throw new ConfigError(
        `deploy.secrets: ${JSON.stringify(name)} не похоже на имя переменной — здесь перечисляются имена секретов, а не их значения`,
        'deploy.secrets',
      );
    }
  }
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
  // На Windows-клоне текст .pipeline/config.yml приходит с CRLF (см. .gitattributes),
  // а сгенерированный workflow сверяет хеш по байтам файла командой sha256sum. Чтобы
  // один и тот же смысл конфига не давал разный хеш из-за перевода строк, нормализуем
  // CRLF к LF перед хешированием — так же, как это делает DRIFT_SCRIPT в generate-ci.mjs.
  const normalized = rawText.replace(/\r\n/g, '\n');
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}
