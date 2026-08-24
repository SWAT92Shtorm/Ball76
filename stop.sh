#!/bin/zsh
# ============================================================
# Ball76 — остановка: zrok-туннель + Docker-контейнеры
#
# Использование:
#   ./stop.sh             # остановить всё (tуннель + контейнеры)
#   ./stop.sh --keep-db   # остановить только tуннель, БД оставить
# ============================================================

cd "$(dirname "$0")"

POSTGRES="Ball76-postgres"
NODE="Ball76-node-server"

echo "🛑 Остановка Ball76..."

# 1. Останавливаем zrok-туннель
if [ -f .zrok.pid ]; then
  PID=$(cat .zrok.pid)
  if kill -0 "${PID}" 2>/dev/null; then
    echo "⬇️  Останавливаю zrok (PID ${PID})..."
    kill "${PID}" 2>/dev/null || true
  fi
  rm -f .zrok.pid
fi

# Убиваем и foreground-процессы zrok с нашим именем (если остались)
pkill -f "zrok share public.*public:ball76" 2>/dev/null || true

# 2. Останавливаем Docker-контейнеры (если не просили сохранить БД)
if [ "$1" != "--keep-db" ]; then
  if docker ps --format '{{.Names}}' | grep -q "^${NODE}$"; then
    echo "⬇️  Останавливаю ${NODE}..."
    docker stop "${NODE}" > /dev/null
  fi
  if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES}$"; then
    echo "⬇️  Останавливаю ${POSTGRES}..."
    docker stop "${POSTGRES}" > /dev/null
  fi
else
  echo "ℹ️  Docker-контейнеры оставлены работать (--keep-db)"
fi

echo "✅ Готово."
