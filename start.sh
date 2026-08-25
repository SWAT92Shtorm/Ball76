#!/bin/zsh
# ============================================================
# Ball76 — быстрый запуск: Docker (Postgres + Node) + туннель
#
# Туннель: localtunnel (loca.lt) — работает из РФ без регистрации.
# Запасной вариант (cloudflared) выбирает ./tunnel.sh автоматически.
#
# Использование:
#   ./start.sh            # запустить всё, туннель в foreground
#   ./start.sh --bg       # туннель в фоне (PID в .tunnel.pid)
#   ./stop.sh             # остановить туннель и контейнеры
# ============================================================

set -e
cd "$(dirname "$0")"

POSTGRES="Ball76-postgres"
NODE="Ball76-node-server"
PORT=8080

echo "🚀 Запуск Ball76..."

# 1. Поднимаем Docker-контейнеры (если не работают)
if ! docker ps --format '{{.Names}}' | grep -q "^${POSTGRES}$"; then
  echo "⬆️  Поднимаю ${POSTGRES}..."
  docker start "${POSTGRES}" > /dev/null
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${NODE}$"; then
  echo "⬆️  Поднимаю ${NODE}..."
  docker start "${NODE}" > /dev/null
fi

# Ждём, пока сервер начнёт отвечать
echo "⏳ Жду готовности API на http://localhost:${PORT} ..."
for i in {1..30}; do
  if curl -sS --max-time 2 "http://localhost:${PORT}/" > /dev/null 2>&1; then
    echo "✅ API готов"
    break
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "❌ API не ответил за 30 сек. Проверь: docker logs ${NODE}"
    exit 1
  fi
done

# 2. Запускаем туннель (localtunnel → запасной cloudflared)
#    Скрипт сам проверит, что запросы проходят, и сохранит URL в .tunnel.url
./tunnel.sh

echo ""
echo "📍 Публичный URL:  $(cat .tunnel.url)"
echo "📍 Локальный API:  http://localhost:${PORT}"
echo ""
echo "Остановка: ./stop.sh"
