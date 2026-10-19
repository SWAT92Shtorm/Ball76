# Деплой на сервер — пошаговая инструкция

Сервер: `31.56.211.5` (root), сайт: https://ball76.duckdns.org
SSH-ключ: `~/.ssh/id-ball76`

## Быстрый деплой (стандартный случай)

### Шаг 1. Закоммитить и запушить на GitHub
```bash
cd /Users/vsn/Documents/Свое/GIT/Ball76
git add .
git commit -m "описание изменений"
git push origin main
```

### Шаг 2. Загрузить изменённые файлы на сервер
```bash
rsync -az -e "ssh -i ~/.ssh/id-ball76" \
  app.js server.js styles.css index.html \
  root@31.56.211.5:/opt/ball76/
```

### Шаг 3. Перезапустить node-контейнер (только если менялся `server.js`)
```bash
ssh -i ~/.ssh/id-ball76 root@31.56.211.5 'cd /opt/ball76 && docker compose restart node'
```

### Шаг 4. Пересобрать бота (только если менялись файлы в `bot/`)
```bash
ssh -i ~/.ssh/id-ball76 root@31.56.211.5 'cd /opt/ball76 && docker compose up -d --build bot'
```

### Шаг 5. Проверить, что сервер отвечает
```bash
ssh -i ~/.ssh/id-ball76 root@31.56.211.5 'curl -s -o /dev/null -w "%{http_code}" https://ball76.duckdns.org/'
# Ожидаем: 200
```

---

## Если менялась БД (миграции) или данные залов

### Обновить данные залов в БД (если менялся формат `schedule`)
```bash
ssh -i ~/.ssh/id-ball76 root@31.56.211.5 "docker exec ball76-db psql -U Ball76 -d Ball76 -c 'SELECT sys_name, schedule FROM public.halls;'"
```

### Применить миграцию
```bash
ssh -i ~/.ssh/id-ball76 root@31.56.211.5 'docker exec -i ball76-db psql -U Ball76 -d Ball76 < migrations/003_halls.sql'
```

---

## Полезные команды

| Действие | Команда |
|----------|--------|
| Логи API | `ssh ball76 'cd /opt/ball76 && docker compose logs -f node'` |
| Логи бота | `ssh ball76 'cd /opt/ball76 && docker compose logs -f bot'` |
| Статус контейнеров | `ssh ball76 'cd /opt/ball76 && docker compose ps'` |
| Бэкап БД | `ssh ball76 'cd /opt/ball76 && docker exec ball76-db pg_dump -U Ball76 -d Ball76 --clean --if-exists --no-owner > backups/backup_$(date +%F).sql'` |

---

## Важно про кеш браузера

nginx кеширует JS/CSS с `max-age=604800` (7 дней). После деплоя фронтенда
обновляйте страницу с очисткой кеша: **Cmd+Shift+R** (Mac) / **Ctrl+Shift+R** (Win).
