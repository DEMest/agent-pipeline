import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// Версия читается из package.json, а не дублируется константой: два места
// с одним номером неизбежно разъезжаются, и артефакт начинает врать о том,
// чем он сгенерирован.
const packagePath = join(dirname(dirname(fileURLToPath(import.meta.url))), 'package.json');
export const VERSION = JSON.parse(readFileSync(packagePath, 'utf8')).version;

export const GENERATOR_MARKER = '# generated-by: agent-pipeline ';

// Артефакт помнит, каким инструментом сделан. Хеш конфига этого не покрывает:
// конфиг мог не меняться месяцами, пока генератор ушёл вперёд, и без отдельной
// пометки узнать об устаревании было бы неоткуда.
export function generatorLine() {
  return `${GENERATOR_MARKER}${VERSION}`;
}

export function versionOf(artifactText) {
  const line = artifactText.split('\n').find((l) => l.startsWith(GENERATOR_MARKER));
  return line ? line.slice(GENERATOR_MARKER.length).trim() : null;
}
