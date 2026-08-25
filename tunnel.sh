#!/bin/bash
# ============================================================
#  Ball76 — туннель к локальному серверу (localhost:8080)
#
#  Проверяет варианты по очереди и печатает первый рабочий адрес:
#    1. localtunnel (loca.lt)   — работает из РФ, без регистрации
#    2. cloudflared quick tunnel — нужен стабильный выход в интернет
#
#  Использование:
#    ./tunnel.sh          — запустить (убивает предыдущие туннели)
#    ./tunnel.sh stop     — остановить все туннели
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
  pkill -f "cloudflared tunnel" 2>/dev/null
  pkill -f "zrok share" 2>/dev/null
  rm -f .tunnel.pid .tunnel.url
  sleep 1
}

if [ "${1:-}" = "stop" ]; then
  stop_all
  echo "✅ Туннели остановлены"
  exit 0
fi

# 0. Сервер должен быть запущен
if ! curl -s -m 3 "http://localhost:$PORT/" > /dev/null 2>&1; then
  echo "❌ Сервер на localhost:$PORT не отвечает. Сначала запустите: ./start.sh --bg"
  exit 1
fi

stop_all
echo "⏳ Останавливаю старые туннели..."

# Проверка живости процесса (npm exec + node-обёртка)
is_alive() {
  kill -0 "$1" 2>/dev/null
}

# ==== Вариант 1: localtunnel ====
echo "🚀 Запускаю localtunnel..."
nohup npx --yes localtunnel --port "$PORT" > .lt.log 2>&1 &
LT_PID=$!

LT_URL=""
for i in $(seq 1 15); do
  sleep 4
  LT_URL=$(grep -a -o 'https://[a-z0-9-]*\.loca\.lt' .lt.log 2>/dev/null | head -1)
  if [ -n "$LT_URL" ]; then
    # Ждём, пока процесс stabilizes (иногда падает сразу после выдачи URL)
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
      echo "   ⚠️ При открытии в браузере loca.lt покажет страницу-"
      echo "      заглушку с кнопкой «Visit» — нажмите её один раз."
      echo "      Для API-запросов из кода: заголовок bypass-tunnel-reminder: 1"
      echo ""
      echo "   Остановить: ./tunnel.sh stop"
      exit 0
    fi
    sleep 8
  done
  echo "⚠️ localtunnel выдал адрес, но запросы не проходят. Пробую cloudflared..."
  kill $LT_PID 2>/dev/null
fi

# ==== Вариант 2: cloudflared ====
echo "🚀 Запускаю cloudflared quick tunnel..."
rm -f .cf.log
nohup cloudflared tunnel --url "http://localhost:$PORT" --no-autoupdate \
  > .cf.log 2>&1 &
CF_PID=$!

CF_URL=""
for i in $(seq 1 12); do
  sleep 5
  CF_URL=$(grep -a -o 'https://[a-z0-9-]*\.trycloudflare\.com' .cf.log 2>/dev/null | head -1)
  [ -n "$CF_URL" ] && break
done

if [ -n "$CF_URL" ]; then
  for i in 1 2 3; do
    RESP=$(curl -s -m 15 "$CF_URL/api/status" 2>/dev/null)
    if echo "$RESP" | grep -q '"db"'; then
      echo "$CF_PID" > .tunnel.pid
      echo "$CF_URL" > .tunnel.url
      echo ""
      echo "✅ ТУННЕЛЬ РАБОТАЕТ: $CF_URL"
      echo ""
      echo "   Остановить: ./tunnel.sh stop"
      exit 0
    fi
    sleep 10
  done
fi

echo ""
echo "❌ Ни один туннель не прошёл проверку из этой сети."
echo "   Логи: .lt.log, .cf.log"
echo "   Попробуйте мобильный интернет (модем телефона) и запустите скрипт снова."
exit 1
