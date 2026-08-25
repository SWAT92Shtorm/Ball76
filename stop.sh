#!/bin/zsh
# ============================================================
# Ball76 — остановка: туннель + Docker-контейнеры
#
# Использование:
#   ./stop.sh             # остановить всё (туннель + контейнеры)
#   ./stop.sh --keep-db   # остановить только туннель, БД оставить
# ============================================================

cd "$(dirname "$0")"

POSTGRES="Ball76-postgres"
NODE="Ball76-node-server"

echo "🛑 Остановка Ball76..."

# 1. Останавливаем туннель (localtunnel)
./tunnel.sh stop > /dev/null 2>&1 || true

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
