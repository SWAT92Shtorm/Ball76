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
#  Логика: поднимаем ОДИН туннель последовательно — пробуем 1, при неудаче
#  (не отвечает / процесс упал / поддомен занят) — 2, затем 3. Как только
#  один прошёл проверку — останавливаемся, остальные НЕ поднимаем.
#
#  Если запущенный туннель отвалится во время работы — watch-режим каждые
#  15 минут это заметит и поднимет новый (сначала снова пробует 1, при
#  неудаче 2/3). Клиент также умеет сам переключаться на резервные адреса
#  (логика в app.js, список адресов — в APP_CONFIG.tunnels).
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

# Поднимаем ПОСЛЕДОВАТЕЛЬНО: пробуем 1, при неудаче — 2, затем 3.
# Как только ОДИН туннель прошёл проверку — останавливаемся и НЕ поднимаем
# остальные: они будут запущены автоматически в watch-режиме, если этот
# отвалится (см. блок «Все туннели мертвы» ниже).
for i in "${!SUBDOMAINS[@]}"; do
  if start_one_tunnel "$i"; then
    echo "   ℹ️ Туннель $((i+1)) работает, остальные не поднимаю."
    break
  else
    echo "   ℹ️ Туннель $((i+1)) не запустился, пробую следующий..."
  fi
done

# Сколько туннелей живо сейчас (после последовательного запуска — 0 или 1)
STARTED_COUNT=0
for i in "${!ALIVE[@]}"; do
  [ "${ALIVE[$i]:-false}" = true ] && STARTED_COUNT=$((STARTED_COUNT + 1))
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

# Режим watch: скрипт остаётся в терминале и следит за туннелем.
# Локальные туннели loca.lt живут недолго (~5–10 минут), поэтому проверяем
# часто: раз в 60 секунд. При падении сразу поднимаем новый (сначала снова
# пробует поддомен 1, при неудаче 2/3). Ctrl+C — остановит и завершит.
if [ "$WATCH_MODE" = true ]; then
  trap 'echo ""; echo "🛑 Останавливаю туннели..."; ./tunnel.sh stop; exit 0' INT TERM

  # Функция: поднять ОДИН рабочий туннель последовательно (1 → 2 → 3).
  # Заполняет PIDS/URLS/ALIVE для успешного индекса, сбрасывает остальные.
  restart_single() {
    # Сбрасываем состояние всех
    local j
    for j in "${!PIDS[@]}"; do
      [ -n "${PIDS[$j]:-}" ] && kill "${PIDS[$j]}" 2>/dev/null
      ALIVE[$j]=false
      URLs[$j]=""
      PIDS[$j]=""
    done
    for j in "${!SUBDOMAINS[@]}"; do
      if start_one_tunnel "$j"; then
        return 0
      fi
    done
    return 1
  }

  # Обновить файлы .tunnel.pid / .tunnel.url по первому живому туннелю
  update_pid_url_files() {
    local j
    for j in "${!URLS[@]}"; do
      if [ "${ALIVE[$j]:-false}" = true ] && [ -n "${URLS[$j]:-}" ]; then
        echo "${PIDS[$j]}" > .tunnel.pid
        echo "${URLS[$j]}" > .tunnel.url
        return 0
      fi
    done
    return 1
  }

  CONSECUTIVE_FAILURES=0
  MAX_CONSECUTIVE_FAILURES=5

  while true; do
    sleep 60
    TS=$(date '+%Y-%m-%d %H:%M')

    # Ищем текущий живой туннель
    CURRENT_IDX=-1
    for i in "${!PIDS[@]}"; do
      if [ "${ALIVE[$i]:-false}" = true ] && [ -n "${PIDS[$i]:-}" ]; then
        CURRENT_IDX=$i
        break
      fi
    done

    if [ "$CURRENT_IDX" -eq -1 ]; then
      # Живого туннеля нет — поднимаем новый
      echo "[$TS] ⚠️  Нет живого туннеля, запускаю..."
      if restart_single; then
        update_pid_url_files
        CONSECUTIVE_FAILURES=0
        echo "[$TS] ✅ Туннель запущен."
      else
        CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
        echo "[$TS] ❌ Не удалось запустить туннель (попыток подряд: $CONSECUTIVE_FAILURES)."
        if [ "$CONSECUTIVE_FAILURES" -ge "$MAX_CONSECUTIVE_FAILURES" ]; then
          echo "[$TS] ❌ Слишком много неудачных попыток ($CONSECUTIVE_FAILURES). Проверьте сеть/сервер."
          echo "       Скрипт продолжит попытки раз в минуту."
        fi
      fi
      continue
    fi

    # Есть живой туннель — проверяем его
    local_ok=true
    if ! is_alive "${PIDS[$CURRENT_IDX]}"; then
      echo "[$TS] ⚠️  Туннель $((CURRENT_IDX+1)): процесс умер, перезапускаю..."
      local_ok=false
    else
      CHECK=$(curl -s -m 10 -H "bypass-tunnel-reminder: 1" "${URLS[$CURRENT_IDX]}/api/status" 2>/dev/null)
      if ! echo "$CHECK" | grep -q '"db"'; then
        echo "[$TS] ⚠️  Туннель $((CURRENT_IDX+1)): API не отвечает, перезапускаю..."
        local_ok=false
      fi
    fi

    if [ "$local_ok" = false ]; then
      if restart_single; then
        update_pid_url_files
        CONSECUTIVE_FAILURES=0
        echo "[$TS] ✅ Туннель перезапущен."
      else
        CONSECUTIVE_FAILURES=$((CONSECUTIVE_FAILURES + 1))
        echo "[$TS] ❌ Не удалось перезапустить туннель (попыток подряд: $CONSECUTIVE_FAILURES)."
      fi
      continue
    fi

    # Всё ок — сбрасываем счётчик неудач, тихо логируем
    CONSECUTIVE_FAILURES=0
    echo "[$TS] ✅ Туннель жив: ${URLS[$CURRENT_IDX]}"
  done
fi

exit 0
