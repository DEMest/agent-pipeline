#!/usr/bin/env sh
# generated-from-config: sha256:d4211995483a45b9360db5286114d44f5dd80f8a57bd2218180c2192e706f189
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
