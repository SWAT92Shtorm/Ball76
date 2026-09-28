# 🏀 Ball76 — гайд по проекту

> Приложение записи на баскетбол в Ярославле. Залы **ЛОКОМОТИВ** и **АТЛАНТ**.
> Сайт + REST API + PostgreSQL, развёрнуто в облаке CloudCore.

---

## 🌐 Живые адреса

| Что | Адрес |
|-----|-------|
| **Сайт (продакшен)** | **https://ball76.duckdns.org** |
| API | https://ball76.duckdns.org/api |
| Swagger-документация | https://ball76.duckdns.org/api/docs |
| Проверка статуса | https://ball76.duckdns.org/api/status |
| Сервер (IP) | `31.56.211.5` |
| SSH | `ssh -i ~/.ssh/id-ball76 root@31.56.211.5` |

---

## 📁 Что лежит в папке `Ball76`

### Фронтенд (клиентская часть, отдаётся браузеру)

| Файл | Размер | Назначение |
|------|--------|------------|
| [`index.html`](index.html:1) | ~6 КБ | Главная страница: форма записи, выбор зала, ФИО, длительность |
| [`app.js`](app.js:1) | ~70 КБ | Вся клиентская логика: загрузка конфига, запись, автокомплит ФИО, команды, история |
| [`styles.css`](styles.css:1) | ~23 КБ | Стили интерфейса |
| [`ball.png`](ball.png:1) | ~5 КБ | Иконка сайта (favicon) и og:image |

### Бэкенд (Node.js + Express)

| Файл | Размер | Назначение |
|------|--------|------------|
| [`server.js`](server.js:1) | ~39 КБ | REST API, вся бизнес-логика, работа с PostgreSQL |
| [`swagger.js`](swagger.js:1) | ~1.5 КБ | Конфигурация Swagger/OpenAPI для `/api/docs` |
| [`package.json`](package.json:1) | 260 Б | Зависимости: express, express-rate-limit, pg, swagger-ui-express |
| [`package-lock.json`](package-lock.json:1) | ~54 КБ | Зафиксированные версии зависимостей |

### Скрипты локального запуска (только для Mac, в облаке не нужны)

| Файл | Назначение |
|------|------------|
| [`start.sh`](start.sh:1) | Локальный запуск: Postgres + Node в Docker + туннель localtunnel |
| [`stop.sh`](stop.sh:1) | Остановка туннеля и контейнеров (`--keep-db` — оставить БД) |
| [`tunnel.sh`](tunnel.sh:1) | Туннель loca.lt (резервные поддомены ball76api-1/2/3) |

> ⚠️ Эти три скрипта — **легаси** для локальной разработки. В облаке их заменяет `docker compose`.

### SEO / метаданные

| Файл | Назначение |
|------|------------|
| [`robots.txt`](robots.txt:1) | Правила для поисковых роботов + ссылка на sitemap |
| [`sitemap.xml`](sitemap.xml:1) | Карта сайта с адресом https://ball76.duckdns.org/ |

### Служебные

| Файл | Назначение |
|------|------------|
| `ball76_dump.sql` | Дамп базы (players, games, game_players) — снят локально, залит на сервер в `/opt/ball76/backups/` |
| `.gitignore` | Исключения: `node_modules/`, `.DS_Store`, `.lt*.log`, pid-файлы |
| `.lt*.log`, `.DS_Store` | Логи туннеля и системный мусор macOS |

---

## ⚙️ Как это работает

```
Браузер ──HTTPS──► nginx (443) ──┬── /            → статика (index.html, app.js, styles.css)
                                 │
                                 └── /api/*        → Node-контейнер (127.0.0.1:8080)
                                                          │
                                                          └──► PostgreSQL (только внутренняя сеть)
```

- **Один домен** для страницы и API — [`app.js`](app.js:98) берёт адрес API как `location.origin`, CORS не нужен.
- **Конфиг (залы, цены, телефоны, расписание)** живёт в [`server.js`](server.js:209) (`APP_CONFIG`) и отдаётся клиенту через `GET /api/config`. Дублировать его в `index.html`/`app.js` не нужно.

---

## 🗄️ База данных

**Таблицы:**

| Таблица | Сущность | Связь |
|---------|----------|-------|
| `players` | Игроки (ФИО, уникальное) | 1 игрок → много записей |
| `games` | Игры (зал + дата) | 1 игра → много записей |
| `game_players` | Записи | PK `(game_id, player_id)` — защита от дублей |

**Правила игры:**
- Максимум **18** игроков на игру ([`server.js`](server.js:217))
- Минимум **10** человек для игры
- Даты в формате `YYYY-MM-DD` (московское время)

**Доступ к БД:**
- В облаке: `DATABASE_URL=postgres://Ball76:<пароль>@db:5432/Ball76`, пароль в `/opt/ball76/.env`
- Локально: `postgres://Ball76:Ball76@localhost:5432/Ball76`

---

## 🔌 API (кратко)

Полная документация — `https://ball76.duckdns.org/api/docs` (Swagger UI).

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/api/config` | Конфиг: залы, цены, телефоны, расписание, лимиты |
| GET | `/api/status` | Статус сервиса и БД (`{"db":true}`) |
| GET | `/api/players` | Список записей |
| POST | `/api/players/:hallId` | Записать игрока |
| GET | `/api/players/:hallId/:date` | Список игроков на дату |
| PATCH | `/api/player/name` | Изменить имя игрока |
| DELETE | `/api/players/:hallId/:date/:name` | Удалить запись |
| GET | `/api/history` | История записей |
| GET | `/api/signup-stats/:hallId` | Статистика записей |
| GET | `/api/docs` | Swagger UI |

**Защита:** rate-limit — 10 мутаций/мин и 120 чтений/мин с одного IP ([`server.js`](server.js:69)).

---

## ☁️ Облако (CloudCore)

### Сервер

| Параметр | Значение |
|----------|----------|
| Хост | `server-ball76` |
| IP | `31.56.211.5` |
| ОС | Ubuntu 24.04 LTS |
| Ресурсы | 1 vCPU / 2 ГБ RAM / 19 ГБ NVMe |
| Тариф | ~99 ₽/мес (≈ 0.14 ₽/час, почасовой биллинг) |

**Установлено:** Docker 29.8.1, Docker Compose v5.5.1, nginx 1.24, certbot 2.9.0, ufw, swap 1 ГБ.

### Где что лежит на сервере

| Путь | Что |
|------|-----|
| `/opt/ball76/` | Корень проекта: `app.js`, `index.html`, `server.js`, `styles.css` и т.д. |
| `/opt/ball76/docker-compose.yml` | Описание контейнеров db + node |
| `/opt/ball76/.env` | `POSTGRES_PASSWORD` (права `600`) |
| `/opt/ball76/backups/` | Резервные копии БД (права `750`); тут лежит `ball76_dump.sql` |
| `/etc/nginx/sites-available/ball76` | Конфиг nginx (статика + прокси /api) |
| `/etc/letsencrypt/live/ball76.duckdns.org/` | TLS-сертификат |

> 📦 **Структура на сервере:** код проекта — в корне `/opt/ball76`, а **дампы БД вынесены в `/opt/ball76/backups/`**, чтобы не смешивать рабочий код и резервные копии.

### Контейнеры

| Контейнер | Образ | Порт | Рестарт |
|-----------|-------|------|---------|
| `ball76-db` | postgres:16 | только внутренняя сеть | unless-stopped |
| `ball76-node` | node:20-alpine | `127.0.0.1:8080` | unless-stopped |

### Безопасность

- `ufw`: входящие — только **22, 80, 443**. Остальное запрещено.
- Postgres и Node **не** доступны из интернета.
- Вход по SSH — **только по ключу** `~/.ssh/id-ball76`.
- HTTPS от Let's Encrypt, автообновление через `certbot.timer`, HTTP→HTTPS редирект (301).

---

## 🔑 Ключи и доступы

| Что | Где |
|-----|-----|
| Приватный SSH-ключ Ball76 | `~/.ssh/id-ball76` (на Mac, никому не передавать) |
| Публичный SSH-ключ | `~/.ssh/id-ball76-pub` (вставлен на сервер) |
| Рабочий SSH-ключ | `~/.ssh/id_rsa` + `id_rsa.pub` (к этому проекту не относится) |
| Домен | DuckDNS: `ball76.duckdns.org` → `31.56.211.5` |
| Пароль БД | `/opt/ball76/.env` на сервере |

**Алиас для удобства** (в `~/.ssh/config`):
```
Host ball76
    HostName 31.56.211.5
    User root
    IdentityFile ~/.ssh/id-ball76
```
Тогда вход — просто `ssh ball76`.

---

## 🌍 Домен и HTTPS

### Что используется

| Параметр | Значение |
|----------|----------|
| Домен | **`ball76.duckdns.org`** |
| Тип | Бесплатный поддомен **DuckDNS** (динамический DNS) |
| Куда ведёт | A-запись → `31.56.211.5` (IP сервера) |
| Сертификат | Let's Encrypt, `CN=ball76.duckdns.org`, действует до **2026-12-27** |
| Обновление | автоматически, `certbot.timer` (dry-run проверен) |
| Редирект | `http://` → `https://` (301) |

### Почему именно так

- **Свой домен (`.ru`) стоит денег** (~300–900 ₽/год), а полноценный бесплатный не выдаётся.
- **DuckDNS** даёт бесплатный поддомен `имя.duckdns.org`. Соответствие «имя → IP» хранится в аккаунте DuckDNS, поэтому имя может быть любым (`ball76`).
- **Сертификат нужен именно на домен:** Let's Encrypt **не выдаёт сертификаты на IP-адреса**, только на DNS-имена. Поэтому домен — обязательное условие для HTTPS.
- **HTTPS закрывает передачу ФИО игроков** открытым текстом и убирает «Не защищено» в браузере.

### Альтернативы (если понадобится)

| Вариант | Имя | Регистрация |
|---------|-----|-------------|
| **DuckDNS** (используется) | `ball76.duckdns.org` | 1 минута через GitHub |
| nip.io | `ball76.31.56.211.5.nip.io` | не нужна, IP внутри имени |
| sslip.io | `ball76.31.56.211.5.sslip.io` | не нужна, IP внутри имени |
| eu.org | `ball76.eu.org` | ручная модерация (дни–недели) |
| свой `.ru` | `ball76.ru` | платно |

> ⚠️ `ball76.nip.io` **не сработает** — nip.io определяет IP из имени, и без IP в имени вернёт localhost.

### Управление доменом

**Сменить IP (если сервер переедет):**
1. Зайти на **duckdns.org** (вход через GitHub).
2. В строке `ball76` поле **current ip** → новый IP → **update ip**.

**Перевыпустить сертификат вручную:**
```bash
ssh ball76 'certbot --nginx -d ball76.duckdns.org'
```

**Проверить, что домен указывает на сервер:**
```bash
nslookup ball76.duckdns.org 8.8.8.8
# должно вернуть 31.56.211.5
```

**Проверить статус и срок сертификата:**
```bash
ssh ball76 'certbot certificates'
```

### Как домен привязан в коде

| Файл | Что изменено |
|------|--------------|
| [`index.html`](index.html:9) | canonical, og:url, og:image → `https://ball76.duckdns.org/` |
| [`robots.txt`](robots.txt:3) | Sitemap → `https://ball76.duckdns.org/sitemap.xml` |
| [`sitemap.xml`](sitemap.xml:4) | `<loc>` → `https://ball76.duckdns.org/` |
| [`app.js`](app.js:98) | API-адрес = `location.origin` (тот же домен, что и страница) |

> В [`app.js`](app.js:98) домен **не прописан жёстко** — берётся текущий origin. Поэтому смена домена не требует правок в коде.

---

## 🛠️ Частые операции

### Посмотреть состояние
```bash
ssh ball76

cd /opt/ball76
docker compose ps            # контейнеры
docker compose logs -f node  # логи API (Ctrl+C — выход)
docker stats --no-stream     # память / CPU
```

### Перезапустить
```bash
cd /opt/ball76 && docker compose restart
```

### Обновить сайт после правок на Mac
```bash
rsync -az --exclude node_modules \
  -e "ssh -i ~/.ssh/id-ball76" \
  /Users/vsn/Documents/Свое/GIT/Ball76/ \
  root@31.56.211.5:/opt/ball76/
```
> Изменения в статике (`index.html`, `app.js`, `styles.css`) применяются сразу.
> После правки `server.js` выполните `docker compose restart node`.

### Резервная копия базы
Дампы складываются в `/opt/ball76/backups/`:
```bash
ssh ball76 'cd /opt/ball76 && docker exec ball76-db \
  pg_dump -U Ball76 -d Ball76 --clean --if-exists --no-owner > backups/backup_$(date +%F).sql'
```

### Восстановить базу из дампа
```bash
ssh ball76 'cd /opt/ball76 && docker exec -i ball76-db \
  psql -U Ball76 -d Ball76 < backups/ball76_dump.sql'
```

### Автобэкап по расписанию (cron)
Ежедневно в 04:00:
```bash
ssh ball76 '(crontab -l 2>/dev/null; echo "0 4 * * * cd /opt/ball76 && docker exec ball76-db pg_dump -U Ball76 -d Ball76 --clean --if-exists --no-owner > backups/backup_\$(date +\%F).sql") | crontab -'
```

### Проверить сертификат
```bash
ssh ball76 'certbot certificates'
ssh ball76 'certbot renew --dry-run'
```

### Проверить сайт и API снаружи
```bash
curl -I https://ball76.duckdns.org/
curl https://ball76.duckdns.org/api/status
```

---

## 🧑‍💻 Локальный запуск (для разработки на Mac)

```bash
# Docker Desktop должен быть запущен
./start.sh          # Postgres + Node в Docker + туннель
./stop.sh           # остановить всё
./stop.sh --keep-db # остановить только туннель, БД оставить
```

- Локальный API: `http://localhost:8080`
- Туннель: `https://ball76api-N.loca.lt` (для доступа извне без облака)

---

## 💰 Стоимость и лимиты

| Что | Значение |
|-----|----------|
| Тариф сервера | 1 vCPU / 2 ГБ / 20 ГБ NVMe — 99 ₽/мес |
| Почасовая ставка | ~0.14 ₽/час (730 ч × 0.14 ≈ 99 ₽) |
| Домен DuckDNS | бесплатно |
| Сертификат Let's Encrypt | бесплатно, автообновление |
| Трафик | включён (1 ТБ по тарифу) |

> Сервер тарифицируется, **пока существует**. Если не нужен — **удалить** в панели CloudCore (просто «выключить» не всегда бесплатно).

---

## ⚠️ Известные мелочи

- `start.sh` / `tunnel.sh` в облаке не используются — только для локальной разработки.
- IP сервера статический. Если он когда-нибудь изменится — обновить IP в панели DuckDNS (`update ip`).
- Старая копия на GitHub Pages (`swat92shtorm.github.io/Ball76`) больше не нужна — сайт целиком работает на сервере.
- **Доступ по SSH:** разрешены и ключ (`id-ball76`), и пароль root. Пароль root сменён владельцем. Если понадобится закрыть вход по паролю (оставив только ключ) — делать это осторожно, с бэкапом `/etc/ssh/sshd_config` и проверкой входа по ключу перед разрывом сессии.

## ✅ Что уже исправлено

- **[`swagger.js`](swagger.js:37)** — адреса серверов обновлены: `https://ball76.duckdns.org` (продакшен) + `localhost:8080` (локалка).
- **[`server.js`](server.js:64)** — добавлен `app.set('trust proxy', 1)`: express-rate-limit корректно определяет IP клиента за nginx (иначе все запросы считались с одного IP, ошибка `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`).
- **[`server.js`](server.js:114)** — исправлены YAML-ошибки в Swagger-комментариях (двоеточия в значениях брались в кавычки): устранена ошибка `YAMLSemanticError`, теперь `/api/docs` показывает все 10 путей.
- **Дампы БД** вынесены в `/opt/ball76/backups/` — код и бэкапы больше не смешиваются.

---

## 📋 TL;DR

| Вопрос | Ответ |
|--------|-------|
| Где сайт? | **https://ball76.duckdns.org** |
| Где код? | `/Users/vsn/Documents/Свое/GIT/Ball76` (локально) → `/opt/ball76` (сервер) |
| Как зайти на сервер? | `ssh -i ~/.ssh/id-ball76 root@31.56.211.5` |
| Где база? | Контейнер `ball76-db`, дампы — `/opt/ball76/backups/` |
| Как обновить сайт? | `rsync ... root@31.56.211.5:/opt/ball76/` |
| Как посмотреть логи? | `docker compose logs -f node` |
