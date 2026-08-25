#!/bin/bash
# ============================================================
#  Ball76 — туннель к локальному серверу (localhost:8080)
#
#  Использует localtunnel (loca.lt) — работает из РФ без регистрации.
#
#  Использование:
#    ./tunnel.sh          — запустить (убивает предыдущий туннель)
#    ./tunnel.sh stop     — остановить туннель
#
#  PID и URL сохраняются в .tunnel.pid / .tunnel.url
# ============================================================

set -u

cd "$(dirname "$0")"
PORT=8080

stop_all() {
  # npm exec оборачивает localtunnel в два процесса — убиваем оба
  pkill -f "localtunnel --port $PORT" 2>/dev/null
  pkill -f "exec localtunnel" 2>/dev/null
  rm -f .tunnel.pid .tunnel.url
  sleep 1
}

if [ "${1:-}" = "stop" ]; then
  stop_all
  echo "✅ Туннель остановлен"
  exit 0
fi

# 0. Сервер должен быть запущен
if ! curl -s -m 3 "http://localhost:$PORT/" > /dev/null 2>&1; then
  echo "❌ Сервер на localhost:$PORT не отвечает. Сначала запустите: ./start.sh --bg"
  exit 1
fi

stop_all
echo "⏳ Останавливаю старый туннель..."

# Проверка живости процесса (npm exec + node-обёртка)
is_alive() {
  kill -0 "$1" 2>/dev/null
}

# ==== Запуск localtunnel ====
echo "🚀 Запускаю localtunnel..."
nohup npx --yes localtunnel --port "$PORT" > .lt.log 2>&1 &
LT_PID=$!

LT_URL=""
for i in $(seq 1 15); do
  sleep 4
  LT_URL=$(grep -a -o 'https://[a-z0-9-]*\.loca\.lt' .lt.log 2>/dev/null | head -1)
  if [ -n "$LT_URL" ]; then
    # Ждём стабилизации (иногда процесс падает сразу после выдачи URL)
    sleep 3
    is_alive $LT_PID && break
    echo "   ⚠️ Процесс localtunnel упал, перезапускаю..."
    rm -f .lt.log
    nohup npx --yes localtunnel --port "$PORT" > .lt.log 2>&1 &
    LT_PID=$!
    LT_URL=""
  fi
done

if [ -n "$LT_URL" ] && is_alive $LT_PID; then
  # Проверка: GET /api/status должен вернуть ответ нашего сервера
  for i in 1 2 3; do
    RESP=$(curl -s -m 15 -H "bypass-tunnel-reminder: 1" "$LT_URL/api/status" 2>/dev/null)
    if echo "$RESP" | grep -q '"db"'; then
      echo "$LT_PID" > .tunnel.pid
      echo "$LT_URL" > .tunnel.url
      echo ""
      echo "✅ ТУННЕЛЬ РАБОТАЕТ: $LT_URL"
      echo ""
      echo "   ⚠️ При открытии в браузере loca.lt попросит ввести IP хоста"
      echo "      (показан на странице) и нажать Continue — один раз."
      echo "      Для API-запросов из кода: заголовок bypass-tunnel-reminder: 1"
      echo ""
      echo "   Остановить: ./tunnel.sh stop"
      exit 0
    fi
    sleep 8
  done
fi

echo ""
echo "❌ Туннель не прошёл проверку из этой сети."
echo "   Лог: .lt.log"
echo "   Попробуйте мобильный интернет (модем телефона) и запустите скрипт снова."
exit 1
