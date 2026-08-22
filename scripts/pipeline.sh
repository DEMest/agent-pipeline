#!/usr/bin/env sh
# generated-from-config: sha256:a15da37c98be5548f28016cd704d75ffbbacb62e649847fb36d7365debde36fd
# Файл сгенерирован из .pipeline/config.yml. Правки затрутся при следующей генерации:
# меняйте .pipeline/config.yml и перезапускайте генерацию.
set -eu

check_test() {
  npm test
}

case "${1:-all}" in
  test) check_test ;;
  all) check_test ;;
  *)
    echo "неизвестная проверка: $1 (доступны: test, all)" >&2
    exit 2
    ;;
esac
