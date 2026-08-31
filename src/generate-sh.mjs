import { generatorLine } from './version.mjs';

export function generatePipelineSh(config, hash) {
  const names = Object.keys(config.checks);
  const lines = [
    '#!/usr/bin/env sh',
    `# generated-from-config: sha256:${hash}`,
    generatorLine(),
    '# Файл сгенерирован из .pipeline/config.yml. Правки затрутся при следующей генерации:',
    '# меняйте .pipeline/config.yml и перезапускайте генерацию.',
    'set -eu',
    '',
  ];

  for (const name of names) {
    lines.push(`check_${name}() {`);
    lines.push(`  ${config.checks[name]}`);
    lines.push('}');
    lines.push('');
  }

  lines.push('case "${1:-all}" in');
  for (const name of names) {
    lines.push(`  ${name}) check_${name} ;;`);
  }
  lines.push(`  all) ${names.map((n) => `check_${n}`).join('; ')} ;;`);
  lines.push('  *)');
  lines.push(`    echo "неизвестная проверка: $1 (доступны: ${names.join(', ')}, all)" >&2`);
  lines.push('    exit 2');
  lines.push('    ;;');
  lines.push('esac');
  lines.push('');

  return lines.join('\n');
}
