#!/bin/zsh
# ============================================================
# Ball76 — быстрый запуск: Docker (Postgres + Node) + туннель
#
# Туннель: localtunnel (loca.lt) — работает из РФ без регистрации.
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

# Node-сервер: bridge-сеть + проброс порта + DATABASE_URL через host.docker.internal
# (Docker Desktop на macOS не поддерживает --network host для доступа к хосту)
NODE_RUNNING=$(docker ps --format '{{.Names}}' | grep -c "^${NODE}$" || true)
if [ "$NODE_RUNNING" -eq 0 ]; then
  echo "⬆️  Запускаю ${NODE}..."
  # Если контейнер существует, но не работает — пересоздаём (IP мог измениться)
  if docker ps -a --format '{{.Names}}' | grep -q "^${NODE}$"; then
    docker rm "${NODE}" > /dev/null 2>&1
  fi
  docker run -d --name "${NODE}" \
    -p "${PORT}:8080" \
    -e DATABASE_URL="postgres://Ball76:Ball76@host.docker.internal:5432/Ball76" \
    --add-host host.docker.internal:host-gateway \
    -v "$(pwd)/server.js:/app/server.js" \
    -v "$(pwd)/swagger.js:/app/swagger.js" \
    -v "$(pwd)/package.json:/app/package.json" \
    -v "$(pwd)/node_modules:/app/node_modules" \
    -w /app node:20-alpine node server.js > /dev/null
else
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

# 2. Запускаем туннель (localtunnel) в watch-режиме:
#    каждые 15 минут проверяет живость, при падении — перезапускает
./tunnel.sh --watch

echo ""
echo "📍 Публичный URL:  $(cat .tunnel.url)"
echo "📍 Локальный API:  http://localhost:${PORT}"
echo ""
echo "Остановка: ./stop.sh"
