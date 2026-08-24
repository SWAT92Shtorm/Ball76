#!/bin/zsh
# ============================================================
# Ball76 — быстрый запуск: Docker (Postgres + Node) + zrok-туннель
#
# Использование:
#   ./start.sh            # запустить всё, tуннель в foreground
#   ./start.sh --bg       # tуннель в фоне (PID в .zrok.pid)
#   ./stop.sh             # остановить tуннель и контейнеры
# ============================================================

set -e
cd "$(dirname "$0")"

POSTGRES="Ball76-postgres"
NODE="Ball76-node-server"
ZROK_NAME="public:ball76"
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

# 2. Проверяем, не запущен ли уже zrok-туннель с нашим именем
if ps aux | grep -E "zrok share public.*${ZROK_NAME}" | grep -v grep > /dev/null; then
  echo "ℹ️  Zrok-туннель уже работает"
else
  echo "🌐 Запускаю zrok-туннель (имя: ball76)..."
  if [ "$1" = "--bg" ]; then
    nohup zrok share public "http://localhost:${PORT}" -n "${ZROK_NAME}" --headless \
      > .zrok.log 2>&1 &
    echo $! > .zrok.pid
    sleep 4
    echo "   Tуннель в фоне, PID=$(cat .zrok.pid), лог: .zrok.log"
  else
    # Foreground: Ctrl+C остановит tуннель, но Docker останется работать
    trap 'echo ""; echo "👋 Tуннель остановлен. Docker-контейнеры продолжают работать."; exit 0' INT TERM
    exec zrok share public "http://localhost:${PORT}" -n "${ZROK_NAME}"
  fi
fi

echo ""
echo "📍 Публичный URL:  https://ball76.shares.zrok.io"
echo "📍 Локальный API:  http://localhost:${PORT}"
echo ""
echo "Остановка: ./stop.sh"
