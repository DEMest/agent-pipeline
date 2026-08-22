import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { loadConfig, configHash } from './config.mjs';
import { generatePipelineSh } from './generate-sh.mjs';
import { generateCi } from './generate-ci.mjs';

const MARKER = '# generated-from-config: sha256:';

function artifactPaths(projectDir) {
  return {
    configPath: join(projectDir, '.pipeline', 'config.yml'),
    shPath: join(projectDir, 'scripts', 'pipeline.sh'),
    ciPath: join(projectDir, '.github', 'workflows', 'ci.yml'),
  };
}

function writeFileLf(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.replace(/\r\n/g, '\n'), 'utf8');
}

export function generateInto(projectDir) {
  const { configPath, shPath, ciPath } = artifactPaths(projectDir);
  const config = loadConfig(configPath);
  const hash = configHash(readFileSync(configPath, 'utf8'));

  writeFileLf(shPath, generatePipelineSh(config, hash));
  writeFileLf(ciPath, generateCi(config, hash));

  return { written: [shPath, ciPath], hash };
}

export function checkDrift(projectDir) {
  const { configPath, shPath, ciPath } = artifactPaths(projectDir);
  const expected = configHash(readFileSync(configPath, 'utf8'));
  const stale = [];

  for (const path of [shPath, ciPath]) {
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

const [, , command, projectDir] = process.argv;
if (command && projectDir) {
  if (command === 'generate') {
    const { written } = generateInto(projectDir);
    for (const path of written) console.log(`записано: ${path}`);
  } else if (command === 'check') {
    const { ok, stale } = checkDrift(projectDir);
    if (!ok) {
      for (const path of stale) console.error(`устарело: ${path}`);
      process.exit(1);
    }
    console.log('артефакты соответствуют конфигу');
  } else {
    console.error(`неизвестная команда: ${command} (доступны: generate, check)`);
    process.exit(2);
  }
}
