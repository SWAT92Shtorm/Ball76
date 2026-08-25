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
SUBDOMAIN="ball76api"

stop_all() {
  # npm exec оборачивает localtunnel в два процесса — убиваем оба
  pkill -f "localtunnel --port $PORT" 2>/dev/null
  pkill -f "exec localtunnel" 2>/dev/null
  rm -f .tunnel.pid .tunnel.url
  sleep 1
}

WATCH_MODE=false
if [ "${1:-}" = "--watch" ] || [ "${1:-}" = "-w" ]; then
  WATCH_MODE=true
fi

if [ "${1:-}" = "stop" ]; then
  stop_all
  pkill -f "tunnel.sh.*watch" 2>/dev/null
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
# Пробуем зафиксировать поддомен $SUBDOMAIN. Если loca.lt выдал
# альтернативный адрес — используем его (один запуск, без ретраев).
echo "🚀 Запускаю localtunnel ($SUBDOMAIN.loca.lt)..."
nohup npx --yes localtunnel --port "$PORT" -s "$SUBDOMAIN" > .lt.log 2>&1 &
LT_PID=$!

LT_URL=""
for i in $(seq 1 10); do
  sleep 4
  GOT_URL=$(grep -a -o 'https://[a-z0-9-]*\.loca\.lt' .lt.log 2>/dev/null | head -1)
  if [ -n "$GOT_URL" ]; then
    sleep 3
    if ! is_alive $LT_PID; then
      echo "   ⚠️ Процесс упал."
      break
    fi
    if [ "$GOT_URL" = "https://$SUBDOMAIN.loca.lt" ]; then
      LT_URL="$GOT_URL"
    else
      echo "   ℹ️ Поддомен занят, выдан: $GOT_URL"
      LT_URL="$GOT_URL"
    fi
    break
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
      echo ""

      # Режим watch: скрипт остаётся в терминале и печатает статус
      # каждые 15 минут. Ctrl+C — остановит туннель и завершит скрипт.
      if [ "$WATCH_MODE" = true ]; then
        trap 'echo ""; echo "🛑 Останавливаю туннель..."; ./tunnel.sh stop; exit 0' INT TERM

        while true; do
          sleep 600
          TS=$(date '+%Y-%m-%d %H:%M')
          # Проверка: процесс жив + API отвечает через туннель
          if ! kill -0 "$LT_PID" 2>/dev/null; then
            echo "[$TS] ⚠️  Туннель умер, перезапускаю..."
            stop_all
            # Повторный запуск (без watch — родительский цикл продолжит мониторинг)
            nohup npx --yes localtunnel --port "$PORT" -s "$SUBDOMAIN" > .lt.log 2>&1 &
            LT_PID=$!
            for i in $(seq 1 10); do
              sleep 4
              NEW_URL=$(grep -a -o 'https://[a-z0-9-]*\.loca\.lt' .lt.log 2>/dev/null | head -1)
              if [ -n "$NEW_URL" ]; then
                LT_URL="$NEW_URL"
                echo "$LT_PID" > .tunnel.pid
                echo "$LT_URL" > .tunnel.url
                echo "[$(date '+%H:%M')] ✅ Туннель перезапущен: $LT_URL"
                break
              fi
            done
            continue
          fi
          CHECK=$(curl -s -m 10 -H "bypass-tunnel-reminder: 1" "$LT_URL/api/status" 2>/dev/null)
          if ! echo "$CHECK" | grep -q '"db"'; then
            echo "[$TS] ⚠️  Туннель не отвечает, перезапускаю..."
            stop_all
            nohup npx --yes localtunnel --port "$PORT" -s "$SUBDOMAIN" > .lt.log 2>&1 &
            LT_PID=$!
            for i in $(seq 1 10); do
              sleep 4
              NEW_URL=$(grep -a -o 'https://[a-z0-9-]*\.loca\.lt' .lt.log 2>/dev/null | head -1)
              if [ -n "$NEW_URL" ]; then
                LT_URL="$NEW_URL"
                echo "$LT_PID" > .tunnel.pid
                echo "$LT_URL" > .tunnel.url
                echo "[$(date '+%H:%M')] ✅ Туннель перезапущен: $LT_URL"
                break
              fi
            done
            continue
          fi
          echo "[$TS] ✅ Туннель жив: $LT_URL"
        done
      fi
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
