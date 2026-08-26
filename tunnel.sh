#!/bin/bash
# ============================================================
#  Ball76 — туннели к локальному серверу (localhost:8080)
#
#  Использует localtunnel (loca.lt) — работает из РФ без регистрации.
#
#  Запускает ТРИ резервных туннеля ПОСЛЕДОВАТЕЛЬНО с фиксированными
#  поддоменами:
#    https://ball76api-1.loca.lt
#    https://ball76api-2.loca.lt
#    https://ball76api-3.loca.lt
#
#  Логика: сначала поднимаем основной (1). Если он не прошёл проверку
#  (не отвечает / процесс упал / поддомен занят) — поднимаем резервный (2),
#  затем (3). Так мы не расходим ресурсы зря, если основной работает.
#
#  Если один отвалится во время работы — клиент автоматически переключится
#  на другой (логика в app.js, список адресов — в APP_CONFIG.tunnels).
#  Watch-режим каждые 15 минут проверяет живость и перезапускает упавшие.
#
#  Использование:
#    ./tunnel.sh          — запустить (последовательно, пока не появится рабочий)
#    ./tunnel.sh stop     — остановить все туннели
#
#  PID и URL сохраняются в .tunnel.pid / .tunnel.url
# ============================================================

set -u

cd "$(dirname "$0")"
PORT=8080
SUBDOMAINS=("ball76api-1" "ball76api-2" "ball76api-3")

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

# ==== Функция: поднять один туннель и проверить его ====
# Аргументы: i (индекс в SUBDOMAINS)
# Возвращает: 0 если туннель работает, 1 если нет.
# При успехе заполняет PIDS[i], URLs[i], ALIVE[i].
start_one_tunnel() {
  local i=$1
  local SUB="${SUBDOMAINS[$i]}"
  local N=$((i + 1))
  local LOG=".lt-${N}.log"

  echo "🚀 Запускаю localtunnel ($SUB.loca.lt)..."
  nohup npx --yes localtunnel --port "$PORT" -s "$SUB" > "$LOG" 2>&1 &
  local LT_PID=$!
  PIDS[$i]=$LT_PID
  ALIVE[$i]=false
  URLs[$i]=""

  # Ждём URL (до 40 сек)
  local GOT_URL=""
  for attempt in $(seq 1 10); do
    sleep 4
    GOT_URL=$(grep -a -o 'https://[a-z0-9-]*\.loca\.lt' "$LOG" 2>/dev/null | head -1)
    if [ -n "$GOT_URL" ]; then
      break
    fi
  done

  if [ -z "$GOT_URL" ]; then
    echo "   ❌ Туннель $N: URL не получен за 40 сек. Лог: $LOG"
    return 1
  fi

  sleep 3
  if ! is_alive "$LT_PID"; then
    echo "   ⚠️ Туннель $N: процесс упал после получения URL."
    return 1
  fi

  local EXPECTED="https://${SUB}.loca.lt"
  if [ "$GOT_URL" != "$EXPECTED" ]; then
    # Поддомен занят — выдан альтернативный адрес.
    # Убиваем этот процесс: клиент знает только фиксированные адреса,
    # альтернативный ему бесполезен. Пробуем следующий поддомен.
    echo "   ⚠️ Туннель $N: поддомен $SUB занят, loca.lt выдал: $GOT_URL"
    echo "      Убиваю процесс (клиент знает только ball76api-N.loca.lt)."
    kill "$LT_PID" 2>/dev/null
    wait "$LT_PID" 2>/dev/null
    ALIVE[$i]=false
    URLs[$i]=""
    PIDS[$i]=""
    return 1
  fi

  # Проверяем: GET /api/status должен вернуть ответ нашего сервера
  local RESP=""
  for try in 1 2 3; do
    RESP=$(curl -s -m 15 -H "bypass-tunnel-reminder: 1" "$GOT_URL/api/status" 2>/dev/null)
    if echo "$RESP" | grep -q '"db"'; then
      break
    fi
    sleep 5
  done

  if ! echo "$RESP" | grep -q '"db"'; then
    echo "   ❌ Туннель $N: API не ответил через $GOT_URL"
    kill "$LT_PID" 2>/dev/null
    wait "$LT_PID" 2>/dev/null
    ALIVE[$i]=false
    URLs[$i]=""
    PIDS[$i]=""
    return 1
  fi

  # Успех
  URLs[$i]="$GOT_URL"
  ALIVE[$i]=true
  echo "   ✅ Туннель $N работает: $GOT_URL"
  return 0
}

# ==== Последовательный запуск: пробуем 1, при неудаче — 2, затем 3 ====
declare -a PIDS=("" "" "")
declare -a URLs=("" "" "")
declare -a ALIVE=(false false false)

STARTED_COUNT=0
for i in "${!SUBDOMAINS[@]}"; do
  if start_one_tunnel "$i"; then
    STARTED_COUNT=$((STARTED_COUNT + 1))
    # Основной (первый) поднялся — останавливаемся, резервные не нужны.
    # Если это был уже не первый — значит предыдущие не работали,
    # продолжаем поднимать остальные для резервирования.
    if [ "$i" -eq 0 ]; then
      echo "   ℹ️ Основной туннель работает, резервные не поднимаю."
      break
    fi
  else
    echo "   ℹ️ Туннель $((i+1)) не запустился, пробую следующий..."
  fi
done

if [ "$STARTED_COUNT" -eq 0 ]; then
  echo ""
  echo "❌ Ни один туннель не прошёл проверку из этой сети."
  echo "   Логи: .lt-1.log .lt-2.log .lt-3.log"
  echo "   Попробуйте мобильный интернет (модем телефона) и запустите скрипт снова."
  exit 1
fi

# Сохраняем PID первого живого туннеля и его URL (для обратной совместимости)
FIRST_OK=""
FIRST_URL=""
for i in "${!URLS[@]}"; do
  if [ "${ALIVE[$i]:-false}" = true ] && [ -n "${URLS[$i]:-}" ]; then
    FIRST_OK="${PIDS[$i]}"
    FIRST_URL="${URLS[$i]}"
    break
  fi
done

echo "$FIRST_OK" > .tunnel.pid
echo "$FIRST_URL" > .tunnel.url

echo ""
echo "✅ ЗАПУЩЕНО ТУННЕЛЕЙ: $STARTED_COUNT из ${#SUBDOMAINS[@]}"
for i in "${!URLS[@]}"; do
  if [ "${ALIVE[$i]:-false}" = true ] && [ -n "${URLS[$i]:-}" ]; then
    echo "   $((i+1)). ${URLS[$i]}"
  fi
done
echo ""
echo "   ⚠️ При открытии в браузере loca.lt попросит ввести IP хоста"
echo "      (показан на странице) и нажать Continue — один раз."
echo "      Для API-запросов из кода: заголовок bypass-tunnel-reminder: 1"
echo ""
echo "   Остановить: ./tunnel.sh stop"
echo ""

# Режим watch: скрипт остаётся в терминале и печатает статус
# каждые 15 минут. Ctrl+C — остановит туннели и завершит скрипт.
if [ "$WATCH_MODE" = true ]; then
  trap 'echo ""; echo "🛑 Останавливаю туннели..."; ./tunnel.sh stop; exit 0' INT TERM

  while true; do
    sleep 600
    TS=$(date '+%Y-%m-%d %H:%M')

    # Проверяем каждый запущенный туннель: процесс жив + API отвечает.
    # Если что-то сломалось — перезапускаем ТОЛЬКО этот туннель.
    for i in "${!PIDS[@]}"; do
      [ "${ALIVE[$i]:-false}" != true ] && continue
      [ -z "${PIDS[$i]:-}" ] && continue

      local_ok=true
      # 1. Процесс жив?
      if ! is_alive "${PIDS[$i]}"; then
        echo "[$TS] ⚠️  Туннель $((i+1)): процесс умер, перезапускаю..."
        local_ok=false
      # 2. API отвечает?
      else
        CHECK=$(curl -s -m 10 -H "bypass-tunnel-reminder: 1" "${URLS[$i]}/api/status" 2>/dev/null)
        if ! echo "$CHECK" | grep -q '"db"'; then
          echo "[$TS] ⚠️  Туннель $((i+1)): API не отвечает, перезапускаю..."
          local_ok=false
        fi
      fi

      if [ "$local_ok" = false ]; then
        # Убиваем старый процесс (если ещё жив)
        [ -n "${PIDS[$i]:-}" ] && kill "${PIDS[$i]}" 2>/dev/null
        wait "${PIDS[$i]}" 2>/dev/null
        ALIVE[$i]=false
        URLs[$i]=""
        PIDS[$i]=""
        # Пробуем поднять заново
        if start_one_tunnel "$i"; then
          # Обновляем файлы pid/url, если это был первый живой
          for j in "${!URLS[@]}"; do
            if [ "${ALIVE[$j]:-false}" = true ] && [ -n "${URLS[$j]:-}" ]; then
              echo "${PIDS[$j]}" > .tunnel.pid
              echo "${URLS[$j]}" > .tunnel.url
              break
            fi
          done
        else
          echo "[$TS] ❌ Туннель $((i+1)) не удалось перезапустить."
        fi
      fi
    done

    # Итог: сколько туннелей живо сейчас
    LIVE_NOW=0
    for i in "${!ALIVE[@]}"; do
      [ "${ALIVE[$i]:-false}" = true ] && LIVE_NOW=$((LIVE_NOW + 1))
    done

    if [ "$LIVE_NOW" -eq 0 ]; then
      echo "[$TS] ❌ Все туннели мертвы. Перезапускаю последовательно..."
      # Полный перезапуск: пробуем 1, при неудаче 2, затем 3
      for i in "${!SUBDOMAINS[@]}"; do
        if start_one_tunnel "$i"; then
          if [ "$i" -eq 0 ]; then
            break
          fi
        fi
      done
      # Обновляем файлы
      for i in "${!URLS[@]}"; do
        if [ "${ALIVE[$i]:-false}" = true ] && [ -n "${URLS[$i]:-}" ]; then
          echo "${PIDS[$i]}" > .tunnel.pid
          echo "${URLS[$i]}" > .tunnel.url
          break
        fi
      done
      continue
    fi

    echo "[$TS] ✅ Живых туннелей: $LIVE_NOW"
    for i in "${!URLS[@]}"; do
      [ "${ALIVE[$i]:-false}" = true ] && [ -n "${URLS[$i]:-}" ] && echo "   $((i+1)). ${URLS[$i]}"
    done
  done
fi

exit 0
