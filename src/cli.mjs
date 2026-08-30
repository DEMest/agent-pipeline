#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, configHash } from './config.mjs';
import { generatePipelineSh } from './generate-sh.mjs';
import { generateCi } from './generate-ci.mjs';
import { generateDeploy } from './generate-deploy.mjs';
import { parseFailedLog, describeFailures } from './ci-log.mjs';

const MARKER = '# generated-from-config: sha256:';

function artifactPaths(projectDir) {
  return {
    configPath: join(projectDir, '.pipeline', 'config.yml'),
    shPath: join(projectDir, 'scripts', 'pipeline.sh'),
    ciPath: join(projectDir, '.github', 'workflows', 'ci.yml'),
    deployPath: join(projectDir, '.github', 'workflows', 'deploy.yml'),
  };
}

function writeFileLf(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n/g, '\n'), 'utf8');
}

export function generateInto(projectDir) {
  const { configPath, shPath, ciPath, deployPath } = artifactPaths(projectDir);
  const config = loadConfig(configPath);
  const hash = configHash(readFileSync(configPath, 'utf8'));

  // Сначала сформировать оба текста и только потом писать оба файла: generateCi
  // бросает UnsupportedStackError для python/go/java, и если бы шаблон sh уже
  // был на диске к этому моменту, в проекте остались бы половина артефактов.
  const shText = generatePipelineSh(config, hash);
  const ciText = generateCi(config, hash);
  // Секция deploy необязательна: без неё workflow выкатки не нужен и не создаётся.
  const deployText = generateDeploy(config, hash);

  writeFileLf(shPath, shText);
  writeFileLf(ciPath, ciText);

  const written = [shPath, ciPath];
  if (deployText !== null) {
    writeFileLf(deployPath, deployText);
    written.push(deployPath);
  }

  return { written, hash };
}

export function checkDrift(projectDir) {
  const { configPath, shPath, ciPath, deployPath } = artifactPaths(projectDir);
  const expected = configHash(readFileSync(configPath, 'utf8'));
  const stale = [];

  // Workflow выкатки проверяется, когда конфиг его требует или когда файл уже
  // лежит в проекте. Второе важно не меньше первого: если секцию deploy убрали,
  // а сгенерированный ранее deploy.yml остался, он продолжит выкатывать прод
  // по правилам, которых в конфиге больше нет.
  const paths = [shPath, ciPath];
  let wantsDeploy = existsSync(deployPath);
  try {
    wantsDeploy = wantsDeploy || Boolean(loadConfig(configPath).deploy);
  } catch {
    // Сломанный конфиг — забота других проверок, не этой.
  }
  if (wantsDeploy) paths.push(deployPath);

  for (const path of paths) {
    if (!existsSync(path)) {
      stale.push(path);
      continue;
    }
    const line = readFileSync(path, 'utf8').split('\n').find((l) => l.startsWith(MARKER));
    if (line?.slice(MARKER.length).trim() !== expected) {
      stale.push(path);
    }
  }

  return { ok: stale.length === 0, stale };
}

export function diagnose(projectDir, logPath) {
  let logText;
  try {
    logText = readFileSync(logPath, 'utf8');
  } catch (cause) {
    throw new Error(`не удалось прочитать лог ${logPath}: ${cause.message}`);
  }

  // Конфиг нужен только чтобы связать шаг с командой проверки. Если он сломан или
  // отсутствует, диагноз всё равно полезен — тем более что уронить CI мог именно он.
  let config = null;
  try {
    config = loadConfig(join(projectDir, '.pipeline', 'config.yml'));
  } catch {
    config = null;
  }

  return describeFailures(parseFailedLog(logText), config);
}

const USAGE = [
  'использование: <вызов> <generate|check|diagnose> <каталог проекта> [<путь лога>]',
  'где <вызов> — один из:',
  '  npx --yes github:DEMest/agent-pipeline',
  '  node <путь к репозиторию>/src/cli.mjs',
].join('\n');

// Явный разбор аргументов вместо неявного "если оба на месте": раньше
// `node src/cli.mjs check` без каталога проваливал условие `command && projectDir`
// целиком, ничего не печатал и завершался кодом 0 — вызывающий получал «всё хорошо»
// вместо ошибки о нехватке аргумента.
function runCli(command, projectDir, logPath) {
  if (!command) {
    console.error(USAGE);
    return 2;
  }
  if (command !== 'generate' && command !== 'check' && command !== 'diagnose') {
    console.error(`неизвестная команда: ${command} (доступны: generate, check, diagnose)`);
    return 2;
  }
  if (!projectDir) {
    console.error(USAGE);
    return 2;
  }

  try {
    if (command === 'generate') {
      const { written } = generateInto(projectDir);
      for (const path of written) console.log(`записано: ${path}`);
      return 0;
    }
    if (command === 'check') {
      const { ok, stale } = checkDrift(projectDir);
      if (!ok) {
        for (const path of stale) console.error(`устарело: ${path}`);
        return 1;
      }
      console.log('артефакты соответствуют конфигу');
      return 0;
    }
    if (command === 'diagnose') {
      if (!logPath) {
        console.error(USAGE);
        return 2;
      }
      const text = diagnose(projectDir, logPath);
      console.log(text);
      return 0;
    }
  } catch (e) {
    // Сообщение об ошибке (ConfigError о неверном конфиге, UnsupportedStackError
    // о нереализованном стеке), а не сырой стектрейс Node — README обещает
    // «отказывает явной ошибкой, а не молча», а стектрейс молчит о сути дела.
    console.error(e.message);
    return 1;
  }
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const [, , command, projectDir, logPath] = process.argv;
  process.exitCode = runCli(command, projectDir, logPath);
}
