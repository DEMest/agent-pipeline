#!/usr/bin/env sh
if [ -f .pipeline/config.yml ]; then
  echo "Пайплайн настроен. Конфиг: .pipeline/config.yml"
else
  echo "В этом проекте есть каркас пайплайна, но он не настроен: файла .pipeline/config.yml нет."
  echo "Предложи пользователю запустить /pipeline:init, чтобы развернуть пайплайн."
fi
