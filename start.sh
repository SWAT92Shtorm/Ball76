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

# ==== Функция: создать/пересоздать node-контейнер ====
start_node() {
  if docker ps -a --format '{{.Names}}' | grep -q "^${NODE}$"; then
    docker rm -f "${NODE}" > /dev/null 2>&1
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
}

# ==== 1. Postgres ====
PG_UP=false
if docker ps --format '{{.Names}}' | grep -q "^${POSTGRES}$"; then
  PG_UP=true
else
  echo "⬆️  Поднимаю ${POSTGRES}..."
  docker start "${POSTGRES}" > /dev/null 2>&1 && PG_UP=true
fi

# Ждём, пока Postgres реально принимает соединения (после сна может быть не готов)
if [ "$PG_UP" = true ]; then
  for i in {1..15}; do
    if docker exec "${POSTGRES}" pg_isready -U Ball76 > /dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

# Если Postgres не поднялся или не здоров — пересоздаём
if [ "$PG_UP" != true ] || ! docker exec "${POSTGRES}" pg_isready -U Ball76 > /dev/null 2>&1; then
  echo "⚠️  Postgres не здоров, пересоздаю..."
  docker rm -f "${POSTGRES}" > /dev/null 2>&1
  docker run -d --name "${POSTGRES}" \
    -e POSTGRES_DB=Ball76 \
    -e POSTGRES_USER=Ball76 \
    -e POSTGRES_PASSWORD=Ball76 \
    -p 5432:5432 \
    postgres:16 > /dev/null
  for i in {1..30}; do
    if docker exec "${POSTGRES}" pg_isready -U Ball76 > /dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi
echo "✅ Postgres готов"

# ==== 2. Node-сервер ====
# Всегда пересоздаём: после сна IP host.docker.internal может измениться,
# а старый контейнер с --network host не работает на macOS.
echo "⬆️  Запускаю ${NODE}..."
start_node

# Ждём, пока сервер начнёт отвечать И БД доступна
echo "⏳ Жду готовности API на http://localhost:${PORT} ..."
API_OK=false
for i in {1..30}; do
  STATUS=$(curl -sS --max-time 2 "http://localhost:${PORT}/api/status" 2>/dev/null || true)
  if echo "$STATUS" | grep -q '"db":true'; then
    API_OK=true
    break
  fi
  sleep 1
done

# Если API отвечает, но БД не подключена — пересоздаём node ещё раз
if [ "$API_OK" != true ]; then
  echo "⚠️  API не готов, пересоздаю node-контейнер..."
  start_node
  for i in {1..30}; do
    STATUS=$(curl -sS --max-time 2 "http://localhost:${PORT}/api/status" 2>/dev/null || true)
    if echo "$STATUS" | grep -q '"db":true'; then
      API_OK=true
      break
    fi
    sleep 1
  done
fi

if [ "$API_OK" != true ]; then
  echo "❌ API не ответил за 30 сек. Проверь: docker logs ${NODE}"
  exit 1
fi
echo "✅ API готов (БД подключена)"

# 2. Запускаем туннель (localtunnel) в watch-режиме:
#    каждые 15 минут проверяет живость, при падении — перезапускает
./tunnel.sh --watch

echo ""
echo "📍 Публичный URL:  $(cat .tunnel.url)"
echo "📍 Локальный API:  http://localhost:${PORT}"
echo ""
echo "Остановка: ./stop.sh"
