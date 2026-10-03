const express = require('express');
const rateLimit = require('express-rate-limit');
const crypto = require('crypto');

const app = express();

const { Pool } = require('pg');

// Подключение к PostgreSQL:
// - если задан DATABASE_URL (Railway/продакшен) — используем его
// - иначе локально — Docker-контейнер Ball76-postgres на localhost:5432
const DB_CONFIG = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: 'localhost',
      port: 5432,
      database: 'Ball76',
      user: 'Ball76',
      password: 'Ball76'
    };

// Пул соединений: параллельные запросы + авто-реконнект при обрывах
const pool = new Pool({ ...DB_CONFIG, max: 10 });

pool.on('error', err => {
  console.error('❌ Ошибка idle-соединения пула:', err.message);
});

// Проверка соединения при старте.
// Схема БД уже существует (таблицы players/games/game_players с PK
// game_players(game_id, player_id), который и является уникальным
// ограничением от дублей записи).
pool.query('SELECT 1')
  .then(() => {
    console.log('✅ Подключено к PostgreSQL');
    // Идемпотентно создаём таблицу залов (миграция 003) и загружаем кэш.
    return ensureHallsSchema();
  })
  .then(() => ensureGameConfirmSchema())
  .then(() => loadHallsFromDB())
  .then(() => backfillConfirmedDuration())
  .catch(err => {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
  });

// CORS: разрешаем GitHub Pages (продакшен), localtunnel-туннель и локальные
// origins (localhost/127.0.0.1). Адрес loca.lt меняется при каждом запуске —
// поэтому разрешаем всю зону, а не конкретный поддомен.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isAllowed =
    origin === 'https://swat92shtorm.github.io' ||
    /\.loca\.lt$/.test(origin || '') ||         // localtunnel (локальный туннель)
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');

  if (isAllowed) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  // X-Admin-Token обязателен в списке: браузер делает preflight (OPTIONS) для
  // PATCH с этим заголовком, и без разрешения запрос блокируется (CORS),
  // что проявляется как «ошибка соединения» при сохранении времени.
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Token, bypass-tunnel-reminder');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Парсинг JSON
app.use(express.json());

// Перед приложением стоит один reverse-proxy (nginx), который передаёт
// реальный IP клиента в заголовке X-Forwarded-For. Без этой настройки
// express-rate-limit видит заголовок, но не доверяет прокси, и все запросы
// считаются с одного IP (общий лимит на всех) + ошибка ERR_ERL_UNEXPECTED_X_FORWARDED_FOR.
app.set('trust proxy', 1);

// ==== Rate limiting (защита от спама/ботов) ====
// Мутающие эндпоинты (POST/PATCH/DELETE): жёсткий лимит — 10 запросов
// с одного IP в 1 минуту. Хватает для реального пользователя (запись,
// пара правок имени), но останавливает бота, который пытается заспамить
// базу или исчерпать лимит игры.
const mutationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 10,             // 10 мутаций на окно
  standardHeaders: true,     // заголовки RateLimit-*
  legacyHeaders: false,      // не шлём X-RateLimit-*
  message: { error: 'Слишком много запросов. Попробуйте через минуту.' }
});

// GET-эндпоинты: мягче — 120 запросов в минуту (автообновление каждые
// 30 сек + ручные действия нескольких пользователей с одного IP).
const readLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 минута
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов. Попробуйте позже.' }
});

// PING-домашняя страница — только API-пинг для health-check.
// Фронтенд живёт на GitHub Pages; туннель — чисто API-прокси.
/**
 * @swagger
 * /:
 *   get:
 *     summary: Пинг-проверка сервера
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: Сервер работает
 */
app.get('/', (req, res) => {
  res.send('Server works!');
});

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Получить конфигурацию приложения
 *     description: "Возвращает единый конфиг для клиента: цены, телефоны, расписание, лимиты."
 *     tags: [Config]
 *     responses:
 *       200:
 *         description: Конфигурация загружена
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 maxPlayers:
 *                   type: integer
 *                   description: Максимум игроков на одну игру
 *                   example: 18
 *                 halls:
 *                   type: object
 *                   description: Конфигурация залов
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       name:
 *                         type: string
 *                         example: ЛОКОМОТИВ
 *                       phone:
 *                         type: string
 *                         example: '+7 (961) 154-44-11'
 *                       responsible:
 *                         type: string
 *                         example: Андрей Дубровин
 *                       prices:
 *                         type: object
 *                         properties:
 *                           full:
 *                             type: integer
 *                             description: Цена за 2 часа
 *                             example: 6000
 *                           short:
 *                             type: integer
 *                             description: Цена за 1.5 часа
 *                             example: 4500
 *                       schedule:
 *                         type: array
 *                         items:
 *                           type: object
 *                           properties:
 *                             day:
 *                               type: string
 *                               enum: [Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday]
 *                             from:
 *                               type: integer
 *                               description: Час начала
 *                             to:
 *                               type: integer
 *                               description: Час окончания
 */
app.get('/api/config', (req, res) => {
  res.json(APP_CONFIG);
});

/**
 * @swagger
 * /api/status:
 *   get:
 *     summary: Проверить соединение с базой данных
 *     description: Клиент использует этот эндпоинт, чтобы показать предупреждение «запись пока невозможна», когда сервер не может подключиться к PostgreSQL.
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: Соединение с БД установлено
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 db:
 *                   type: boolean
 *                   example: true
 *       503:
 *         description: Нет соединения с БД
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 db:
 *                   type: boolean
 *                   example: false
 */
app.get('/api/status', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ db: true });
  } catch (err) {
    console.error('❌ Проверка соединения с БД:', err.message);
    res.status(503).json({ db: false });
  }
});

// ==== Единый конфиг приложения ====
// Единственный источник правды: клиент получает его через GET /api/config,
// дублировать эти значения в index.html/app.js больше не нужно.
//
// Залы (halls) теперь живут в БД (public.halls) и подставляются динамически
// через loadHallsFromDB(). DEFAULT_HALLS — резервный набор, используемый,
// если таблица пуста или БД временно недоступна, чтобы сайт не «падал».
const DEFAULT_HALLS = {
  hall1: {
    name: 'ЛОКОМОТИВ',
    phone: '+7 (961) 154-44-11',
    responsible: 'Андрей Дубровин',
    prices: { hourly: 3000, full: 6000, short: 4500 },
    schedule: [
      { day: 'Tuesday', from: 21, to: 23 },
      { day: 'Thursday', from: 21, to: 23 }
    ]
  },
  hall2: {
    name: 'АТЛАНТ',
    phone: '+7 (910) 979-22-99',
    responsible: 'Ярослав Волков',
    // Сумма НЕ делится на участников — каждый платит фиксированные 300 ₽.
    prices: { hourly: 3000, full: 6000, short: 4500 },
    perPerson: 300,
    schedule: [
      { day: 'Friday', from: 21, to: 23 }
    ]
  }
};

// Цена в админке задаётся ЗА ЧАС; 1,5 ч и 2 ч считаются автоматически.
// Хранится в prices.hourly, а full (×2) и short (×1.5) — для клиента.
function pricesFromHourly(hourly) {
  const h = Math.round(Number(hourly) || 0);
  return { hourly: h, full: h * 2, short: Math.round(h * 1.5) };
}

// Привести объект prices к виду { hourly, full, short }.
// Для старых записей без hourly выводим его из full (÷2).
function normalizePrices(p) {
  const src = (p && typeof p === 'object') ? p : {};
  let hourly;
  if (src.hourly != null && Number.isFinite(Number(src.hourly))) {
    hourly = Number(src.hourly);
  } else if (src.full != null && Number.isFinite(Number(src.full))) {
    hourly = Number(src.full) / 2;
  } else {
    hourly = 0;
  }
  return pricesFromHourly(hourly);
}

const APP_CONFIG = {
  // Резервные адреса туннелей (loca.lt): три поддомена, чтобы при отвале
  // одного можно было переключиться на другой. Запускаются ./tunnel.sh.
  tunnels: [
    'https://ball76api-1.loca.lt',
    'https://ball76api-2.loca.lt',
    'https://ball76api-3.loca.lt'
  ],
  maxPlayers: 18,
  // Залы подставляются из БД (см. loadHallsFromDB()).
  halls: DEFAULT_HALLS
};

// ============================================================
// Залы: кэш в памяти, синхронизируемый с таблицей public.halls
// ============================================================
// Публичные эндпоинты (расписание, /api/config) читают залы синхронно,
// поэтому держим копию в памяти. После любой админ-операции кэш перечитывается.
let hallsCache = { ...DEFAULT_HALLS };
let hallIdsCache = Object.keys(DEFAULT_HALLS);

// Дни недели в том же формате, что и в расписании (английские названия).
const HALL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Загрузить активные залы из БД в кэш. При пустой таблице или ошибке
// остаётся резервный набор DEFAULT_HALLS.
async function loadHallsFromDB() {
  try {
    const result = await pool.query(
      `SELECT sys_name, name, phone, responsible, prices, per_person, schedule, active
         FROM public.halls
        ORDER BY id`
    );
    const map = {};
    const ids = [];
    for (const r of result.rows) {
      if (!r.active) continue; // деактивированные залы скрыты от публичных эндпоинтов
      const hall = {
        name: r.name,
        phone: r.phone || '',
        responsible: r.responsible || '',
        prices: normalizePrices(r.prices),
        schedule: Array.isArray(r.schedule) ? r.schedule : []
      };
      if (r.per_person != null) hall.perPerson = r.per_person;
      map[r.sys_name] = hall;
      ids.push(r.sys_name);
    }
    if (ids.length > 0) {
      hallsCache = map;
      hallIdsCache = ids;
      APP_CONFIG.halls = map;
      console.log('✅ Залы загружены из БД:', ids.join(', '));
    }
  } catch (err) {
    console.error('⚠️ Не удалось загрузить залы из БД, использую резервные:', err.message);
  }
}

// Идемпотентно создать таблицу залов и засеять её резервным набором.
// Дублирует migrations/003_halls.sql, чтобы сервер был самодостаточен
// (миграция применяется автоматически при старте).
async function ensureHallsSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.halls (
      id           serial PRIMARY KEY,
      sys_name     text UNIQUE NOT NULL,
      name         text NOT NULL,
      phone        text,
      responsible  text,
      prices       jsonb NOT NULL DEFAULT '{}'::jsonb,
      per_person   integer,
      schedule     jsonb NOT NULL DEFAULT '[]'::jsonb,
      active       boolean NOT NULL DEFAULT true,
      created_at   timestamp without time zone NOT NULL DEFAULT now(),
      updated_at   timestamp without time zone NOT NULL DEFAULT now()
    )
  `);
  // Начальное наполнение — только если таблица пуста.
  const cnt = await pool.query('SELECT COUNT(*)::int AS n FROM public.halls');
  if (cnt.rows[0].n === 0) {
    await pool.query(
      `INSERT INTO public.halls (sys_name, name, phone, responsible, prices, per_person, schedule)
       VALUES
         ($1,$2,$3,$4,$5::jsonb,NULL,$6::jsonb),
         ($7,$8,$9,$10,$11::jsonb,$12,$13::jsonb)
       ON CONFLICT (sys_name) DO NOTHING`,
      [
        'hall1', 'ЛОКОМОТИВ', '+7 (961) 154-44-11', 'Андрей Дубровин',
        JSON.stringify(pricesFromHourly(3000)),
        JSON.stringify([{ day: 'Tuesday', from: 21, to: 23 }, { day: 'Thursday', from: 21, to: 23 }]),
        'hall2', 'АТЛАНТ', '+7 (910) 979-22-99', 'Ярослав Волков',
        JSON.stringify(pricesFromHourly(3000)), 300,
        JSON.stringify([{ day: 'Friday', from: 21, to: 23 }])
      ]
    );
    console.log('✅ Таблица halls создана и заполнена залами по умолчанию');
  }
}

// Идемпотентно добавить поля подтверждения игры (миграция 005).
// Дублирует migrations/005_game_confirmation.sql, чтобы сервер был
// самодостаточен (миграция применяется автоматически при старте).
async function ensureGameConfirmSchema() {
  await pool.query(`
    ALTER TABLE public.games
      ADD COLUMN IF NOT EXISTS confirmed          boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS confirmed_at       timestamp without time zone,
      ADD COLUMN IF NOT EXISTS confirmed_price    integer,
      ADD COLUMN IF NOT EXISTS confirmed_players  integer,
      ADD COLUMN IF NOT EXISTS confirmed_duration numeric
  `);
}

// Идемпотентно дозаполнить длительность у уже подтверждённых игр, у которых
// она не была сохранена (записи до появления колонки). Считается по времени.
async function backfillConfirmedDuration() {
  const { rows } = await pool.query(
    `SELECT id, hall_id, date, start_time, end_time FROM games
      WHERE confirmed = true AND confirmed_duration IS NULL`
  );
  for (const row of rows) {
    let start = row.start_time;
    let end = row.end_time;
    // Нет своего времени — берём расписание зала на дату игры.
    if (!isValidTime(start) || !isValidTime(end)) {
      const sched = scheduleForDate(row.hall_id, formatDateMSK(row.date));
      if (sched) { start = formatHour(sched.from); end = formatHour(sched.to); }
    }
    if (!isValidTime(start) || !isValidTime(end)) continue;
    await pool.query('UPDATE games SET confirmed_duration = $2 WHERE id = $1',
      [row.id, durationHours(start, end)]);
  }
}

// Активен ли зал (используется в публичных эндпоинтах).
function isKnownHall(hallId) {
  return hallIdsCache.includes(hallId);
}

// Пустой объект «зал → список игроков» по всем активным залам.
function emptyPlayersByHall() {
  const obj = {};
  for (const id of hallIdsCache) obj[id] = [];
  return obj;
}

// ============================================================
// Валидация данных зала (для админ-CRUD)
// ============================================================

// Системное имя зала: латиница, цифры, дефис, подчёркивание; 2–32 символа.
const HALL_SYSNAME_REGEX = /^[a-z0-9][a-z0-9_-]{1,31}$/;

// Проверить и нормализовать график зала.
// Ожидает массив [{day, from, to}], возвращает {schedule} либо {error}.
function validateSchedule(raw) {
  if (raw == null) return { schedule: [] };
  if (!Array.isArray(raw)) return { error: 'График должен быть массивом' };
  const schedule = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { error: 'Неверный элемент графика' };
    const day = String(item.day || '');
    if (!HALL_DAYS.includes(day)) return { error: `Неверный день недели: ${day}` };
    const from = Number(item.from);
    const to = Number(item.to);
    if (!Number.isInteger(from) || from < 0 || from > 23) {
      return { error: 'Час начала должен быть целым от 0 до 23' };
    }
    if (!Number.isInteger(to) || to < 1 || to > 24) {
      return { error: 'Час окончания должен быть целым от 1 до 24' };
    }
    if (to <= from) return { error: 'Окончание должно быть позже начала' };
    // Защита от дублей одного дня в графике.
    if (schedule.some(s => s.day === day)) return { error: `День ${day} указан дважды` };
    schedule.push({ day, from, to });
  }
  return { schedule };
}

// Сгенерировать системное имя зала по подобию существующих: hall1, hall2, …
// Берём максимальный суффикс среди имён вида hallN и прибавляем единицу.
async function generateHallSysName() {
  const result = await pool.query(
    `SELECT sys_name FROM public.halls WHERE sys_name ~ '^hall[0-9]+$'`
  );
  let max = 0;
  for (const r of result.rows) {
    const n = parseInt(r.sys_name.slice(4), 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `hall${max + 1}`;
}

// Проверить и нормализовать тело запроса на создание/редактирование зала.
// partial = true для PATCH (обновляются только переданные поля).
function validateHallInput(body, { partial } = {}) {
  const b = body || {};
  const out = {};

  // Системное имя в админке не вводится — сервер генерирует его сам
  // (см. generateHallSysName). Принимаем только если передано явно (API).
  if (b.sysName !== undefined) {
    const sysName = String(b.sysName || '').trim().toLowerCase();
    if (!HALL_SYSNAME_REGEX.test(sysName)) {
      return { error: 'Системное имя: латиница/цифры/дефис, 2–32 символа (например hall3)' };
    }
    out.sysName = sysName;
  }

  if (b.name !== undefined || !partial) {
    const name = String(b.name || '').trim();
    if (!name) return { error: 'Укажите название зала' };
    if (name.length > 60) return { error: 'Название слишком длинное (максимум 60 символов)' };
    out.name = name;
  }

  if (b.phone !== undefined || !partial) {
    out.phone = String(b.phone || '').trim().slice(0, 40);
  }

  if (b.responsible !== undefined || !partial) {
    out.responsible = String(b.responsible || '').trim().slice(0, 80);
  }

  if (b.prices !== undefined || !partial) {
    // В админке вводится ОДНА цена — за час. Остальные считаются:
    // 1,5 ч = час × 1.5, 2 ч = час × 2. Храним все три для обратной
    // совместимости с клиентом, который ожидает prices.full / prices.short.
    const p = b.prices && typeof b.prices === 'object' ? b.prices : {};
    const hourly = Number(p.hourly);
    if (!Number.isFinite(hourly) || hourly < 0) {
      return { error: 'Цена за час должна быть неотрицательным числом' };
    }
    const h = Math.round(hourly);
    out.prices = { hourly: h, full: h * 2, short: Math.round(h * 1.5) };
  }

  if (b.perPerson !== undefined) {
    if (b.perPerson === null || b.perPerson === '' ) {
      out.perPerson = null;
    } else {
      const pp = Number(b.perPerson);
      if (!Number.isFinite(pp) || pp < 0) {
        return { error: 'Сумма с человека должна быть неотрицательным числом' };
      }
      out.perPerson = Math.round(pp);
    }
  } else if (!partial) {
    out.perPerson = null;
  }

  if (b.schedule !== undefined || !partial) {
    const res = validateSchedule(b.schedule);
    if (res.error) return { error: res.error };
    out.schedule = res.schedule;
  }

  if (b.active !== undefined) {
    out.active = !!b.active;
  }

  return { data: out };
}

// Лимит игроков на одну игру
const MAX_PLAYERS = APP_CONFIG.maxPlayers;

// ==== Валидация ФИО (серверная) ====
// Правило совпадает с клиентским: 3–5 слов, каждое — буквы (кириллица/латиница),
// дефис или апостроф внутри слова. Защита от записи «А», «test», SQL-подобных
// строк и т.п. через прямой вызов API.
const NAME_REGEX = /^[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'\-]*(?:\s+[A-Za-zА-Яа-яЁё][A-Za-zА-Яа-яЁё'\-]*){2,4}$/;

/**
 * Проверяет строку как ФИО. Возвращает null при успехе или текст ошибки.
 */
function validateFullName(name) {
  if (typeof name !== 'string') return 'ФИО должно быть строкой';
  const trimmed = name.trim();
  if (!trimmed) return 'ФИО не может быть пустым';
  if (trimmed.length > 80) return 'ФИО слишком длинное (максимум 80 символов)';
  if (!NAME_REGEX.test(trimmed)) {
    return 'ФИО должно состоять из 3–5 слов: Фамилия Имя Отчество (только буквы, дефис и апостроф)';
  }
  return null;
}

// Форматирование даты в московском времени: YYYY-MM-DD
// (pg отдаёт date/timestamp как JS Date; toISOString() даёт UTC и может сдвинуть день)
function formatDateMSK(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date); // en-CA → именно YYYY-MM-DD
}

/**
 * @swagger
 * /api/players:
 *   get:
 *     summary: Получить всех игроков по залам
 *     description: Возвращает список всех игроков, сгруппированных по залам.
 *     tags: [Players]
 *     responses:
 *       200:
 *         description: Список игроков загружен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playersByHall:
 *                   type: object
 *                   properties:
 *                     hall1:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["Иванов Иван Иванович", "Петров Пётр Петрович"]
 *                     hall2:
 *                       type: array
 *                       items:
 *                         type: string
 *                       example: ["Сидоров Сидор Сидорович"]
 *       500:
 *         description: Ошибка чтения из БД
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
app.get('/api/players', readLimiter, async (req, res) => {
  try {
    const result = await pool.query(
 `SELECT
          p.id,
         p.name,
         g.hall_id,
         MIN(gp.created_at) AS first_signup_time
       FROM players p
       JOIN game_players gp ON p.id = gp.player_id
       JOIN games g ON gp.game_id = g.id
       GROUP BY p.id, p.name, g.hall_id
       ORDER BY first_signup_time ASC, p.name;`
    );

    const playersByHall = emptyPlayersByHall();

    result.rows.forEach(row => {
      const hallId = row.hall_id;
      const name = row.name.trim();

      if (!playersByHall[hallId]) {
        playersByHall[hallId] = [];
      }

      playersByHall[hallId].push(name);
    });

    res.json({ playersByHall });
  } catch (err) {
    console.error('Ошибка чтения участников:', err);
    res.status(500).json({
      error: 'Failed to read players from database'
    });
  }
});

/**
 * @swagger
 * /api/telegram-links:
 *   get:
 *     summary: Связки игроков с Telegram
 *     description: >
 *       Возвращает карту «ФИО игрока → аккаунт Telegram» из таблицы
 *       telegram_links. Нужна фронтенду, чтобы рядом с именем показывать
 *       кликабельную ссылку на профиль Telegram (@username).
 *     tags: [Players]
 *     responses:
 *       200:
 *         description: Карта связок получена
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 links:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     properties:
 *                       username:
 *                         type: string
 *                       telegramId:
 *                         type: integer
 *       500:
 *         description: Ошибка чтения из БД
 */
app.get('/api/telegram-links', readLimiter, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT DISTINCT ON (tl.player_name)
             tl.player_name,
             tl.username,
             tl.telegram_id
        FROM telegram_links tl
       WHERE tl.player_name IS NOT NULL
         AND tl.username IS NOT NULL
       ORDER BY tl.player_name, tl.updated_at DESC
    `);

    const links = {};
    for (const row of result.rows) {
      links[row.player_name] = {
        username: row.username,
        telegramId: row.telegram_id
      };
    }

    res.json({ links });
  } catch (err) {
    // Таблицы может не быть (миграция ещё не применена) — не ломаем интерфейс.
    if (err.code === '42P01') {
      return res.json({ links: {} });
    }
    console.error('Ошибка чтения связок Telegram:', err);
    res.status(500).json({ error: 'Failed to read telegram links' });
  }
});

/**
 * @swagger
 * /api/players-directory:
 *   post:
 *     summary: Добавить игрока в справочник (без записи на игру)
 *     description: >
 *       Валидирует ФИО и добавляет его в таблицу players, если такого игрока
 *       ещё нет. Используется ботом Telegram, когда пользователь ввёл своё ФИО,
 *       которого нет в базе — чтобы сразу добавить нового участника.
 *     tags: [Players]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name:
 *                 type: string
 *                 example: Иванов Иван Иванович
 *     responses:
 *       200:
 *         description: Игрок добавлен или уже существует
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 created:
 *                   type: boolean
 *                 name:
 *                   type: string
 *       400:
 *         description: Ошибка валидации ФИО
 */
app.post('/api/players-directory', mutationLimiter, async (req, res) => {
  let { name } = req.body || {};
  const nameError = validateFullName(name);
  if (nameError) {
    return res.status(400).json({ error: nameError });
  }
  name = name.trim();

  try {
    const insert = await pool.query(
      `INSERT INTO players (name)
         VALUES ($1)
       ON CONFLICT (name) DO NOTHING
       RETURNING id;`,
      [name]
    );
    const created = insert.rows.length > 0;
    res.json({ created, name });
  } catch (err) {
    console.error('API players-directory:', err);
    res.status(500).json({ error: 'Не удалось добавить игрока' });
  }
});



/**
 * @swagger
 * /api/players/{hallId}:
 *   post:
 *     summary: Записать игрока на игру
 *     description: Добавляет участника в существующую или новую игру. Вся запись выполняется в одной транзакции для исключения гонок при проверке лимита.
 *     tags: [Players]
 *     parameters:
 *       - in: path
 *         name: hallId
 *         required: true
 *         schema:
 *           type: string
 *           enum: [hall1, hall2]
 *         description: Идентификатор зала
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, date]
 *             properties:
 *               name:
 *                 type: string
 *                 description: ФИО игрока (Фамилия Имя Отчество)
 *                 example: Иванов Иван Иванович
 *               date:
 *                 type: string
 *                 format: date
 *                 description: Дата игры в формате YYYY-MM-DD
 *                 example: '2026-08-25'
 *     responses:
 *       200:
 *         description: Игрок записан
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playersByHall:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: string
 *       400:
 *         description: Ошибка валидации / игра заполнена / игрок уже записан
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   examples:
 *                     bad_request:
 *                       value: "Bad request: name, date, and hallId required"
 *                     full:
 *                       value: "Игра заполнена: максимум 18 человек"
 *                     duplicate:
 *                       value: Игрок уже записан на эту игру
 *       500:
 *         description: Внутренняя ошибка сервера
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
app.post('/api/players/:hallId', mutationLimiter, async (req, res) => {
  const { hallId } = req.params;
  let { name, date } = req.body;

  console.log('1️⃣ addPlayer: name=' + name + ', date=' + date + ', hallId=' + hallId);

  if (!name || !date || !hallId || !isKnownHall(hallId)) {
    console.log('⚠️ Валидация не прошла');
    return res.status(400).json({
      error: 'Bad request: name, date, and hallId required'
    });
  }

  // Серверная валидация ФИО (защита от прямых вызовов API без клиента)
  const nameError = validateFullName(name);
  if (nameError) {
    return res.status(400).json({ error: nameError });
  }
  name = name.trim();

  // Вся запись — в одной транзакции: исключает гонку «два запроса
  // одновременно прошли проверку лимита и оба вставились» (лимит 18).
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Найти или создать игрока
    const playerRes = await client.query(
      `INSERT INTO players (name)
        VALUES ($1)
        ON CONFLICT (name) DO NOTHING
        RETURNING *;`,
      [name]
    );

    let player = playerRes.rows[0];
    if (!player) {
      const selectPlayer = await client.query(
        'SELECT * FROM players WHERE name = $1;',
        [name]
      );
      player = selectPlayer.rows[0];
    }
    if (!player) {
      await client.query('ROLLBACK');
      return res.status(500).json({ error: 'Не удалось найти или создать игрока' });
    }

    // 2. Найти или создать игру
    const findGame = await client.query(
      'SELECT * FROM games WHERE hall_id = $1 AND date = $2 FOR UPDATE;',
      [hallId, date]
    );

    let game;
    if (findGame.rows.length > 0) {
      game = findGame.rows[0];
    } else {
      const createGame = await client.query(
        `INSERT INTO games (hall_id, date)
          VALUES ($1, $2)
          RETURNING *;`,
        [hallId, date]
      );
      game = createGame.rows[0];
    }

    // 3. Проверка лимита игроков на игру
    const countRes = await client.query(
      'SELECT COUNT(*)::int AS count FROM game_players WHERE game_id = $1;',
      [game.id]
    );
    if (countRes.rows[0].count >= MAX_PLAYERS) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Игра заполнена: максимум ${MAX_PLAYERS} человек`
      });
    }

    // 4. Проверка дубликата записи
    const existing = await client.query(
      'SELECT * FROM game_players WHERE game_id = $1 AND player_id = $2;',
      [game.id, player.id]
    );

    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Игрок уже записан на эту игру'
      });
    }

    // 5. Связываем игрока с игрой.
    // Уникальный индекс (game_id, player_id) — страховка от дублей:
    // если параллельный запрос успел записать того же игрока, получим 23505.
    try {
      await client.query(
        `INSERT INTO game_players (game_id, player_id)
          VALUES ($1, $2);`,
        [game.id, player.id]
      );
    } catch (insertErr) {
      if (insertErr.code === '23505') {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Игрок уже записан на эту игру'
        });
      }
      throw insertErr;
    }

    // 6. Читаем список игроков игры (ещё до COMMIT — свои данные видим)
    const gamePlayers = await client.query(
      `SELECT p.name
       FROM game_players gp
       JOIN players p ON gp.player_id = p.id
       WHERE gp.game_id = $1
       ORDER BY gp.created_at ASC, p.name;`,
      [game.id]
    );

    await client.query('COMMIT');

    // Состав изменился — пересчитываем снимок, если игра подтверждена.
    await refreshConfirmedSnapshot(hallId, date).catch(() => {});

    const players = gamePlayers.rows.map(r => r.name);

    res.json({
      playersByHall: { [hallId]: players }
    });
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('❌ Ошибка записи игрока:', err);
    res.status(500).json({
      error: 'Failed to register player'
    });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /api/players/{hallId}/{date}:
 *   get:
 *     summary: Получить игроков на конкретную игру
 *     description: Возвращает список игроков, записанных на игру в указанном зале и дате.
 *     tags: [Players]
 *     parameters:
 *       - in: path
 *         name: hallId
 *         required: true
 *         schema:
 *           type: string
 *           enum: [hall1, hall2]
 *         description: Идентификатор зала
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Дата игры в формате YYYY-MM-DD
 *     responses:
 *       200:
 *         description: Список игроков загружен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 playersByHall:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: string
 *       500:
 *         description: Ошибка чтения из БД
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
app.get('/api/players/:hallId/:date', readLimiter, async (req, res) => {
  const { hallId, date } = req.params;
  
  try {
    const result = await pool.query(`
      SELECT DISTINCT p.name, gp.created_at  
      FROM game_players gp
      JOIN players p ON gp.player_id = p.id
      JOIN games g ON gp.game_id = g.id
      WHERE g.hall_id = $1 AND g.date = $2
      ORDER BY gp.created_at ASC  
    `, [hallId, date]);
    
    const players = result.rows.map(row => row.name);
    
    res.json({ 
      playersByHall: { [hallId]: players } 
    });
  } catch (err) {
    console.error('API players/:hall/:date:', err);
    res.status(500).json({ error: 'Failed to read players' });
  }
});

/**
 * @swagger
 * /api/player/name:
 *   patch:
 *     summary: Переименовать игрока
 *     description: Изменяет ФИО игрока по текущему имени. Возвращает обновлённый список игроков по залам.
 *     tags: [Players]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [currentName, newName]
 *             properties:
 *               currentName:
 *                 type: string
 *                 description: Текущее ФИО игрока
 *                 example: Иванов Иван Иванович
 *               newName:
 *                 type: string
 *                 description: Новое ФИО игрока
 *                 example: Иванов Иван Сергеевич
 *     responses:
 *       200:
 *         description: Имя изменено
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 currentName:
 *                   type: string
 *                 newName:
 *                   type: string
 *                 playersByHall:
 *                   type: object
 *                   additionalProperties:
 *                     type: array
 *                     items:
 *                       type: string
 *       400:
 *         description: Ошибка валидации / игрок с таким именем уже есть
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       404:
 *         description: Игрок не найден
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Внутренняя ошибка сервера
 */
app.patch('/api/player/name', mutationLimiter, requireAdmin, async (req, res) => {
  const { currentName } = req.body;
  let { newName } = req.body;

  // Валидация
  if (!currentName || !newName) {
    return res.status(400).json({
      error: 'currentName и newName обязательны'
    });
  }

  // Серверная валидация нового ФИО
  const nameError = validateFullName(newName);
  if (nameError) {
    return res.status(400).json({ error: nameError });
  }
  newName = newName.trim();

  if (currentName === newName) {
    return res.json({
      success: true,
      message: 'Имя не изменилось',
      newName
    });
  }

  try {
    // проверить, что старое имя существует
    const selectOld = await pool.query(
      'SELECT id FROM players WHERE name = $1',
      [currentName]
    );

    if (selectOld.rows.length === 0) {
      return res.status(404).json({ error: 'Игрок не найден' });
    }

    const playerId = selectOld.rows[0].id;

    // проверить, что такого нового имени еще нет
    const selectNew = await pool.query(
      'SELECT * FROM players WHERE name = $1',
      [newName]
    );

    if (selectNew.rows.length > 0) {
      return res.status(400).json({
        error: `Игрок с таким ФИО уже есть: ${newName}`
      });
    }

    // обновить имя игрока
    await pool.query(
      'UPDATE players SET name = $1 WHERE id = $2',
      [newName, playerId]
    );

    // собрать обновлённый playersByHall (для текущего состояния)
    const result = await pool.query(
      `SELECT
          p.name,
          g.hall_id
        FROM players p
       JOIN game_players gp ON p.id = gp.player_id
       JOIN games g ON gp.game_id = g.id;`
    );

    const playersByHall = emptyPlayersByHall();

    result.rows.forEach(row => {
      const hallId = row.hall_id;
      const name = row.name.trim();

      if (!playersByHall[hallId]) {
        playersByHall[hallId] = [];
      }

      if (!playersByHall[hallId].includes(name)) {
        playersByHall[hallId].push(name);
      }
    });

    res.json({
      success: true,
      currentName,
      newName,
      playersByHall
    });
  } catch (err) {
    console.error('Ошибка при редактировании игрока:', err);
    res.status(500).json({ error: 'Failed to update player' });
  }
});


/**
 * @swagger
 * /api/players/{hallId}/{date}/{name}:
 *   delete:
 *     summary: Удалить игрока из игры
 *     description: Удаляет запись игрока из конкретной игры (зал + дата). Возвращает обновлённый список игроков этой игры.
 *     tags: [Players]
 *     parameters:
 *       - in: path
 *         name: hallId
 *         required: true
 *         schema:
 *           type: string
 *           enum: [hall1, hall2]
 *         description: Идентификатор зала
 *       - in: path
 *         name: date
 *         required: true
 *         schema:
 *           type: string
 *           format: date
 *         description: Дата игры в формате YYYY-MM-DD
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *         description: ФИО игрока (URL-закодированное)
 *     responses:
 *       200:
 *         description: Игрок удалён
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message:
 *                   type: string
 *                   example: Игрок удалён
 *                 playerNames:
 *                   type: array
 *                   items:
 *                     type: string
 *                   description: Обновлённый список игроков этой игры
 *       404:
 *         description: Игра или игрок не найдены
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Внутренняя ошибка сервера
 */
app.delete('/api/players/:hallId/:date/:name', mutationLimiter, async (req, res) => {
  const { hallId, date, name } = req.params;

  try {
    // найти game_id по hall_id и date
    const gameResult = await pool.query(
      `SELECT id FROM games WHERE hall_id = $1 AND date = $2`,
      [hallId, date]
    );
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Игра не найдена' });
    }
    const gameId = gameResult.rows[0].id;

    // найти playerId по имени
    const playerResult = await pool.query(
      `SELECT id FROM players WHERE name = $1`,
      [name]
    );
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Игрок не найден' });
    }
    const playerId = playerResult.rows[0].id;

    // удаляем связь из game_players
    const deleteResult = await pool.query(
      `DELETE FROM game_players
        WHERE player_id = $1 AND game_id = $2`,
      [playerId, gameId]
    );

    // вернуть обновлённый список игроков этой игры
    const updatedResult = await pool.query(
        `SELECT
        p.name
        FROM game_players gp
        JOIN players p ON gp.player_id = p.id
        JOIN games g ON gp.game_id = g.id
        WHERE g.hall_id = $1 AND g.date = $2
        ORDER BY gp.created_at ASC, p.name;`,
      [hallId, date]
    );

    // Состав изменился — пересчитываем снимок, если игра подтверждена.
    await refreshConfirmedSnapshot(hallId, date).catch(() => {});

    const playerNames = updatedResult.rows.map(row => row.name);

    res.json({
      message: 'Игрок удалён',
      playerNames
    });
  } catch (err) {
    console.error('Ошибка удаления игрока:', err);
    res.status(500).json({ error: 'Failed to delete player' });
  }
});


/**
 * @swagger
 * /api/history:
 *   get:
 *     summary: Получить историю записей
 *     description: Возвращает все игры с привязанными игроками, сгруппированные по дате и залу.
 *     tags: [History]
 *     responses:
 *       200:
 *         description: История загружена
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 historyByDate:
 *                   type: object
 *                   additionalProperties:
 *                     type: object
 *                     description: Ключ — дата YYYY-MM-DD, значение — объект с залами
 *                     additionalProperties:
 *                       type: array
 *                       items:
 *                         type: string
 *                       description: Список ФИО игроков
 *       500:
 *         description: Ошибка чтения из БД
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 */
app.get('/api/history', readLimiter, async (req, res) => {
  try {
    // запрос: получить все игры и привязанных к ним игроков
    const result = await pool.query(
        `SELECT
        g.hall_id,
        g.date,
        g.confirmed,
        g.confirmed_price,
        g.confirmed_players,
        g.confirmed_duration,
        p.name
        FROM game_players gp
        JOIN players p ON gp.player_id = p.id
        JOIN games g ON gp.game_id = g.id
        ORDER BY g.date DESC, gp.created_at ASC, p.name;`
    );

    // Структура: historyByDate[date][hallId] = { players: [names...],
    //                                            confirmed, price, playersCount }
    // Подтверждение берём из строки, где оно установлено.
    const historyByDate = {};

    result.rows.forEach(row => {
      const hallId = row.hall_id;
      const date = formatDateMSK(row.date); // YYYY-MM-DD в московском времени
      const name = row.name.trim();

      if (!historyByDate[date]) {
        historyByDate[date] = {};
      }
      if (!historyByDate[date][hallId]) {
        historyByDate[date][hallId] = {
          players: [],
          confirmed: false,
          price: null,
          playersCount: null,
          duration: null
        };
      }

      const entry = historyByDate[date][hallId];
      if (!entry.players.includes(name)) {
        entry.players.push(name);
      }
      // Подтверждение могло стоять на любой из строк игры этой даты.
      if (row.confirmed) {
        entry.confirmed = true;
        if (row.confirmed_price != null) entry.price = Number(row.confirmed_price);
        if (row.confirmed_players != null) entry.playersCount = Number(row.confirmed_players);
        if (row.confirmed_duration != null) entry.duration = Number(row.confirmed_duration);
      }
    });

    // отправить клиенту
    res.json({ historyByDate });
  } catch (err) {
    console.error('❌ Ошибка чтения истории:', err);
    res.status(500).json({
      error: 'Failed to read history'
    });
  }
});

/**
 * @swagger
 * /api/signup-stats/{hallId}:
 *   get:
 *     summary: Статистика записей по дням недели
 *     description: Возвращает количество людей, записавшихся на ближайшую игру в каждый день недели (по created_at).
 *     tags: [Stats]
 *     parameters:
 *       - in: path
 *         name: hallId
 *         required: true
 *         schema:
 *           type: string
 *           enum: [hall1, hall2]
 *     responses:
 *       200:
 *         description: Статистика загружена
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                   description: Всего записано на ближайшую игру
 *                 byDay:
 *                   type: object
 *                   description: Ключ — день недели (1-7), значение — кол-во записей сделанных в этот день
 */
app.get('/api/signup-stats/:hallId', readLimiter, async (req, res) => {
  const { hallId } = req.params;
  if (!isKnownHall(hallId)) {
    return res.status(400).json({ error: 'Invalid hallId' });
  }

  try {
    // Активность записи: сколько человек записалось в каждый день (по дате
    // подписи created_at), по всем предстоящим играм зала. Так запись,
    // сделанная в субботу на игру во вторник, даёт +1 в субботу.
    // created_at — timestamp without tz в UTC (сервер в контейнере UTC),
    // МСК = UTC+3, поэтому добавляем интервал для корректной даты.
    const nowMSK = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
    const stats = await pool.query(
      `SELECT (gp.created_at + INTERVAL '3 hours')::date AS signup_date, COUNT(*)::int AS cnt
         FROM game_players gp
         JOIN games g ON g.id = gp.game_id
        WHERE g.hall_id = $1 AND g.date >= $2::date
        GROUP BY 1
        ORDER BY 1`,
      [hallId, nowMSK]
    );

    const byDate = {};
    let total = 0;
    stats.rows.forEach(row => {
      byDate[formatDateMSK(row.signup_date)] = row.cnt;
      total += row.cnt;
    });

    res.json({ total, byDate });
  } catch (err) {
    console.error('Ошибка signup-stats:', err);
    res.status(500).json({ error: 'Failed to get signup stats' });
  }
});

// ============================================================
// Администрирование: вход по паролю, токен-сессии
// ============================================================
// Пароль администратора. По умолчанию '0000' (как оговорено), в проде
// переопределяется через переменную окружения ADMIN_PASSWORD в .env.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '0000';

// Активные админ-токены: token -> expiry (ms). Храним в памяти процесса —
// при рестарте контейнера все админ-сессии сбрасываются (это нормально,
// админ просто войдёт заново).
const adminTokens = new Map();
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 часов

function issueAdminToken() {
  const token = crypto.randomBytes(24).toString('hex');
  adminTokens.set(token, Date.now() + ADMIN_TOKEN_TTL_MS);
  return token;
}

function isValidAdminToken(token) {
  if (!token) return false;
  const expiry = adminTokens.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) {
    adminTokens.delete(token);
    return false;
  }
  return true;
}

// Middleware: пропускает только запросы с валидным админ-токеном.
// Токен передаётся в заголовке X-Admin-Token.
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (!isValidAdminToken(token)) {
    return res.status(403).json({ error: 'Требуется вход администратора' });
  }
  next();
}

/**
 * @swagger
 * /api/admin/login:
 *   post:
 *     summary: Вход администратора
 *     description: Проверяет пароль и возвращает токен для админ-операций.
 *     tags: [Admin]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password:
 *                 type: string
 *                 example: '0000'
 *     responses:
 *       200:
 *         description: Успешный вход, возвращён токен
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       401:
 *         description: Неверный пароль
 */
app.post('/api/admin/login', mutationLimiter, (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Неверный пароль' });
  }
  const token = issueAdminToken();
  res.json({ token });
});

// ============================================================
// Админ: управление залами и их графиком
// ============================================================
// Возвращает ВСЕ залы (включая деактивированные) в виде плоского массива
// для админ-панели, с флагом hasGames (есть ли по залу игры в БД).
async function listHallsForAdmin() {
  const result = await pool.query(
    `SELECT h.id, h.sys_name, h.name, h.phone, h.responsible, h.prices,
            h.per_person, h.schedule, h.active, h.created_at, h.updated_at,
            EXISTS (SELECT 1 FROM games g WHERE g.hall_id = h.sys_name) AS has_games
       FROM public.halls h
      ORDER BY h.id`
  );
  return result.rows.map(r => ({
    id: r.id,
    sysName: r.sys_name,
    name: r.name,
    phone: r.phone || '',
    responsible: r.responsible || '',
    prices: normalizePrices(r.prices),
    perPerson: r.per_person,
    schedule: Array.isArray(r.schedule) ? r.schedule : [],
    active: r.active,
    hasGames: r.has_games,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

/**
 * @swagger
 * /api/admin/halls:
 *   get:
 *     summary: Список всех залов (админ)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Массив залов
 *       403:
 *         description: Требуется вход администратора
 */
app.get('/api/admin/halls', requireAdmin, async (req, res) => {
  try {
    res.json({ halls: await listHallsForAdmin() });
  } catch (err) {
    console.error('Ошибка чтения залов:', err);
    res.status(500).json({ error: 'Не удалось получить список залов' });
  }
});

/**
 * @swagger
 * /api/admin/halls:
 *   post:
 *     summary: Создать зал
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Зал создан
 *       400:
 *         description: Ошибка валидации / имя занято
 *       403:
 *         description: Требуется вход администратора
 */
app.post('/api/admin/halls', mutationLimiter, requireAdmin, async (req, res) => {
  const v = validateHallInput(req.body, { partial: false });
  if (v.error) return res.status(400).json({ error: v.error });
  const d = v.data;

  try {
    // Имя не задано (обычная работа из админки) — генерируем сами.
    if (!d.sysName) {
      d.sysName = await generateHallSysName();
    }
    const result = await pool.query(
      `INSERT INTO public.halls (sys_name, name, phone, responsible, prices, per_person, schedule, active)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8)
       ON CONFLICT (sys_name) DO NOTHING
       RETURNING id`,
      [
        d.sysName, d.name, d.phone, d.responsible,
        JSON.stringify(d.prices), d.perPerson,
        JSON.stringify(d.schedule), d.active !== false
      ]
    );
    if (result.rowCount === 0) {
      return res.status(400).json({ error: `Зал с именем «${d.sysName}» уже существует` });
    }
    await loadHallsFromDB();
    res.json({ ok: true, halls: await listHallsForAdmin() });
  } catch (err) {
    console.error('Ошибка создания зала:', err);
    res.status(500).json({ error: 'Не удалось создать зал' });
  }
});

/**
 * @swagger
 * /api/admin/halls/{hallId}:
 *   patch:
 *     summary: Изменить зал (в т.ч. график)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Зал изменён
 *       400:
 *         description: Ошибка валидации
 *       403:
 *         description: Требуется вход администратора
 *       404:
 *         description: Зал не найден
 */
app.patch('/api/admin/halls/:hallId', mutationLimiter, requireAdmin, async (req, res) => {
  const { hallId } = req.params;
  const v = validateHallInput(req.body, { partial: true });
  if (v.error) return res.status(400).json({ error: v.error });
  const d = v.data;

  // Собираем SET-часть только из переданных полей.
  const sets = [];
  const vals = [];
  let i = 1;
  const map = {
    sysName: 'sys_name', name: 'name', phone: 'phone', responsible: 'responsible',
    perPerson: 'per_person', active: 'active'
  };
  for (const [key, col] of Object.entries(map)) {
    if (d[key] !== undefined) {
      sets.push(`${col} = $${i++}`);
      vals.push(d[key]);
    }
  }
  if (d.prices !== undefined) { sets.push(`prices = $${i++}::jsonb`); vals.push(JSON.stringify(d.prices)); }
  if (d.schedule !== undefined) { sets.push(`schedule = $${i++}::jsonb`); vals.push(JSON.stringify(d.schedule)); }

  if (sets.length === 0) {
    return res.status(400).json({ error: 'Нет полей для обновления' });
  }
  sets.push('updated_at = now()');
  vals.push(hallId);

  try {
    // Смена sys_name недопустима, если по залу уже есть игры: сломает связь.
    if (d.sysName !== undefined && d.sysName !== hallId) {
      const g = await pool.query('SELECT 1 FROM games WHERE hall_id = $1 LIMIT 1', [hallId]);
      if (g.rowCount > 0) {
        return res.status(400).json({
          error: 'Нельзя менять системное имя зала, по которому уже есть игры. Деактивируйте зал вместо этого.'
        });
      }
    }

    const result = await pool.query(
      `UPDATE public.halls SET ${sets.join(', ')} WHERE sys_name = $${i} RETURNING id`,
      vals
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Зал не найден' });
    }
    await loadHallsFromDB();
    res.json({ ok: true, halls: await listHallsForAdmin() });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'Системное имя уже занято другим залом' });
    }
    console.error('Ошибка изменения зала:', err);
    res.status(500).json({ error: 'Не удалось изменить зал' });
  }
});

/**
 * @swagger
 * /api/admin/halls/{hallId}:
 *   delete:
 *     summary: Удалить зал (или деактивировать, если есть игры)
 *     tags: [Admin]
 *     responses:
 *       200:
 *         description: Зал удалён или деактивирован
 *       403:
 *         description: Требуется вход администратора
 *       404:
 *         description: Зал не найден
 */
app.delete('/api/admin/halls/:hallId', mutationLimiter, requireAdmin, async (req, res) => {
  const { hallId } = req.params;
  try {
    // Защита: нельзя оставить систему без залов.
    const total = await pool.query('SELECT COUNT(*)::int AS n FROM public.halls');
    if (total.rows[0].n <= 1) {
      return res.status(400).json({ error: 'Нельзя удалить последний зал' });
    }
    const g = await pool.query('SELECT 1 FROM games WHERE hall_id = $1 LIMIT 1', [hallId]);
    const hasGames = g.rowCount > 0;

    if (hasGames) {
      // Есть игры — не удаляем, а деактивируем, чтобы сохранить историю.
      const upd = await pool.query(
        'UPDATE public.halls SET active = false, updated_at = now() WHERE sys_name = $1 RETURNING id',
        [hallId]
      );
      if (upd.rowCount === 0) return res.status(404).json({ error: 'Зал не найден' });
      await loadHallsFromDB();
      return res.json({
        ok: true, deactivated: true,
        message: 'По залу есть игры — зал деактивирован (скрыт), история сохранена.',
        halls: await listHallsForAdmin()
      });
    }

    const del = await pool.query('DELETE FROM public.halls WHERE sys_name = $1 RETURNING id', [hallId]);
    if (del.rowCount === 0) return res.status(404).json({ error: 'Зал не найден' });
    await loadHallsFromDB();
    res.json({ ok: true, deleted: true, halls: await listHallsForAdmin() });
  } catch (err) {
    console.error('Ошибка удаления зала:', err);
    res.status(500).json({ error: 'Не удалось удалить зал' });
  }
});

// Повторная загрузка кэша залов из БД (на случай ручных изменений).
app.post('/api/admin/halls/reload', mutationLimiter, requireAdmin, async (req, res) => {
  await loadHallsFromDB();
  res.json({ ok: true, hallIds: hallIdsCache });
});

// ============================================================
// Время игры: отклонение от расписания (override)
// ============================================================

// Валидация времени в формате HH:MM (00:00–23:59).
function isValidTime(str) {
  return typeof str === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(str);
}

// Валидация даты YYYY-MM-DD.
function isValidDateStr(str) {
  return typeof str === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(str)
    && !Number.isNaN(Date.parse(str + 'T12:00:00Z'));
}

// Расписание зала на конкретную дату: { from, to } или null.
// from/to — целые часы (как в APP_CONFIG). Читает залы из кэша (БД).
function scheduleForDate(hallId, dateStr) {
  const hall = hallsCache[hallId];
  if (!hall) return null;
  const d = new Date(dateStr + 'T12:00:00Z'); // полдень UTC — не сдвигаем день
  const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
  const slot = (hall.schedule || []).find(s => s.day === dayName);
  return slot ? { from: slot.from, to: slot.to } : null;
}

function formatHour(h) {
  return String(h).padStart(2, '0') + ':00';
}

// Снимок суммы на одного человека для подтверждённой игры.
// Если у зала задана фиксированная сумма (perPerson) — берём её.
// Иначе делим цену аренды за подтверждённую длительность на число
// записавшихся (в пределах лимита maxPlayers). Возвращает целое число ₽.
function computeConfirmedPrice(hallId, startTime, endTime, playersCount) {
  const hall = hallsCache[hallId] || {};
  if (hall.perPerson != null && Number(hall.perPerson) > 0) {
    return Math.round(Number(hall.perPerson));
  }
  const prices = normalizePrices(hall.prices);
  const duration = durationHours(startTime, endTime);
  let total;
  if (duration <= 1.25) total = prices.hourly;
  else if (duration <= 1.75) total = prices.short;
  else total = prices.full;
  const count = Math.min(Math.max(Number(playersCount) || 0, 1), APP_CONFIG.maxPlayers);
  return Math.round(total / count);
}

// Пересчитать снимок подтверждённой игры (вызывается после смены времени
// или состава участников). Если игра не подтверждена — ничего не делает.
async function refreshConfirmedSnapshot(hallId, dateStr) {
  const row = await pool.query(
    `SELECT confirmed, start_time, end_time FROM games
      WHERE hall_id = $1 AND date = $2
      ORDER BY (start_time IS NOT NULL) DESC, id DESC LIMIT 1`,
    [hallId, dateStr]
  );
  if (!row.rows[0] || !row.rows[0].confirmed) return;

  const info = await getGameTime(hallId, dateStr);
  const cnt = await pool.query(
    `SELECT COUNT(*)::int AS n FROM game_players gp
       JOIN games g ON gp.game_id = g.id
      WHERE g.hall_id = $1 AND g.date = $2`,
    [hallId, dateStr]
  );
  const playersCount = cnt.rows[0] ? cnt.rows[0].n : 0;
  const price = computeConfirmedPrice(hallId, info.startTime, info.endTime, playersCount);

  const duration = durationHours(info.startTime, info.endTime);

  await pool.query(
    `UPDATE games SET confirmed_price = $3, confirmed_players = $4, confirmed_duration = $5
      WHERE hall_id = $1 AND date = $2`,
    [hallId, dateStr, price, playersCount, duration]
  );
}

// Длительность игры в часах по началу и концу 'HH:MM' (с переходом через
// полночь). Если конец не задан — считаем 2 часа (как в админке по умолчанию).
function durationHours(startTime, endTime) {
  if (!isValidTime(startTime) || !isValidTime(endTime)) return 2;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) diff += 24 * 60;
  return diff / 60;
}

// Эффективное время игры: override из БД, если задан, иначе расписание.
// На таблице games уникальность (hall_id, date) не гарантирована, поэтому
// строку с заданным override выбираем приоритетно.
async function getGameTime(hallId, dateStr) {
  const result = await pool.query(
    `SELECT start_time, end_time, time_note, time_changed_at,
            confirmed, confirmed_at, confirmed_price, confirmed_players,
            confirmed_duration
       FROM games WHERE hall_id = $1 AND date = $2
       ORDER BY (start_time IS NOT NULL) DESC, id DESC
       LIMIT 1`,
    [hallId, dateStr]
  );
  const row = result.rows[0] || null;
  const schedule = scheduleForDate(hallId, dateStr);
  const hasOverride = !!(row && row.start_time);
  // «Дополнительная игра» — игра вне обычного графика (день недели не в
  // расписании), время для которой задал админ.
  const isExtra = hasOverride && !schedule;

  const confirmed = !!(row && row.confirmed);
  const confirmedPrice = confirmed && row.confirmed_price != null
    ? Number(row.confirmed_price) : null;
  const confirmedPlayers = confirmed && row.confirmed_players != null
    ? Number(row.confirmed_players) : null;
  const confirmedDuration = confirmed && row.confirmed_duration != null
    ? Number(row.confirmed_duration) : null;

  if (hasOverride) {
    return {
      startTime: row.start_time,
      endTime: row.end_time || null,
      note: row.time_note || '',
      changedAt: row.time_changed_at || null,
      isOverride: true,
      isExtra,
      confirmed,
      confirmedPrice,
      confirmedPlayers,
      confirmedDuration,
      scheduledFrom: schedule ? formatHour(schedule.from) : null,
      scheduledTo: schedule ? formatHour(schedule.to) : null
    };
  }

  return {
    startTime: schedule ? formatHour(schedule.from) : null,
    endTime: schedule ? formatHour(schedule.to) : null,
    note: '',
    changedAt: null,
    isOverride: false,
    isExtra: false,
    confirmed,
    confirmedPrice,
    confirmedPlayers,
    confirmedDuration,
    scheduledFrom: schedule ? formatHour(schedule.from) : null,
    scheduledTo: schedule ? formatHour(schedule.to) : null
  };
}

// Дата в прошлом? (сравниваем с сегодняшним днём по МСК)
function isPastDate(dateStr) {
  return dateStr < formatDateMSK(new Date());
}

/**
 * @swagger
 * /api/games/{hallId}/{date}/time:
 *   get:
 *     summary: Время игры на дату
 *     description: Возвращает эффективное время игры (override или расписание).
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: hallId
 *         required: true
 *         schema: { type: string, enum: [hall1, hall2] }
 *       - in: path
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Время игры
 *       400:
 *         description: Неверные параметры
 */
app.get('/api/games/:hallId/:date/time', readLimiter, async (req, res) => {
  const { hallId, date } = req.params;
  if (!isKnownHall(hallId) || !isValidDateStr(date)) {
    return res.status(400).json({ error: 'Неверный зал или дата' });
  }
  try {
    const info = await getGameTime(hallId, date);
    res.json(info);
  } catch (err) {
    console.error('Ошибка чтения времени игры:', err);
    res.status(500).json({ error: 'Failed to read game time' });
  }
});

/**
 * @swagger
 * /api/games/{hallId}/time-overrides:
 *   get:
 *     summary: Будущие изменения времени по залу
 *     description: Возвращает даты с изменённым временем начала игры.
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: hallId
 *         required: true
 *         schema: { type: string, enum: [hall1, hall2] }
 *     responses:
 *       200:
 *         description: Карта дат с заданным временем начала игры.
 *       400:
 *         description: Неверный зал
 */
app.get('/api/games/:hallId/time-overrides', readLimiter, async (req, res) => {
  const { hallId } = req.params;
  if (!isKnownHall(hallId)) {
    return res.status(400).json({ error: 'Неверный зал' });
  }
  try {
    const today = formatDateMSK(new Date());
    const result = await pool.query(
      `SELECT date, start_time, time_note
         FROM games
        WHERE hall_id = $1 AND start_time IS NOT NULL AND date >= $2
        ORDER BY date`,
      [hallId, today]
    );

    const overrides = {};
    result.rows.forEach(row => {
      const dateStr = formatDateMSK(row.date);
      overrides[dateStr] = {
        startTime: row.start_time,
        note: row.time_note || '',
        isExtra: !scheduleForDate(hallId, dateStr)
      };
    });

    res.json({ overrides });
  } catch (err) {
    console.error('Ошибка чтения изменений времени:', err);
    res.status(500).json({ error: 'Failed to read time overrides' });
  }
});

/**
 * @swagger
 * /api/games/{hallId}/{date}/time:
 *   patch:
 *     summary: Изменить время игры
 *     description: Только для администратора. Задаёт отклонение от расписания.
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: hallId
 *         required: true
 *         schema: { type: string, enum: [hall1, hall2] }
 *       - in: path
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Время изменено
 *       403:
 *         description: Требуется вход администратора
 */
app.patch('/api/games/:hallId/:date/time', mutationLimiter, requireAdmin, async (req, res) => {
  const { hallId, date } = req.params;
  let { startTime, endTime, note } = req.body || {};

  if (!isKnownHall(hallId) || !isValidDateStr(date)) {
    return res.status(400).json({ error: 'Неверный зал или дата' });
  }
  if (isPastDate(date)) {
    return res.status(400).json({ error: 'Нельзя менять время прошедшей игры' });
  }
  // Пока игра подтверждена, время зафиксировано — сначала снимите подтверждение.
  const confirmState = await getGameTime(hallId, date);
  if (confirmState.confirmed) {
    return res.status(409).json({
      error: 'Игра подтверждена. Снимите подтверждение, чтобы изменить время.'
    });
  }
  if (!isValidTime(startTime)) {
    return res.status(400).json({ error: 'startTime должен быть в формате HH:MM' });
  }
  if (endTime != null && endTime !== '' && !isValidTime(endTime)) {
    return res.status(400).json({ error: 'endTime должен быть в формате HH:MM' });
  }
  note = typeof note === 'string' ? note.trim().slice(0, 200) : '';
  if (!note) {
    return res.status(400).json({ error: 'Укажите причину изменения времени' });
  }
  endTime = endTime || null;

  try {
    // Уникальность (hall_id, date) не гарантирована — обновляем существующую
    // игру, а если её ещё нет, создаём. Всё в транзакции.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const upd = await client.query(
        `UPDATE games
            SET start_time = $3, end_time = $4, time_note = $5, time_changed_at = now()
          WHERE hall_id = $1 AND date = $2`,
        [hallId, date, startTime, endTime, note]
      );
      if (upd.rowCount === 0) {
        await client.query(
          `INSERT INTO games (hall_id, date, start_time, end_time, time_note, time_changed_at)
            VALUES ($1, $2, $3, $4, $5, now())`,
          [hallId, date, startTime, endTime, note]
        );
      }
      await client.query('COMMIT');
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw txErr;
    } finally {
      client.release();
    }
    // Если игра была подтверждена — пересчитываем снимок под новое время.
    await refreshConfirmedSnapshot(hallId, date);
    const info = await getGameTime(hallId, date);
    res.json(info);
  } catch (err) {
    console.error('Ошибка изменения времени игры:', err);
    res.status(500).json({ error: 'Failed to update game time' });
  }
});

/**
 * @swagger
 * /api/games/{hallId}/{date}/time:
 *   delete:
 *     summary: Сбросить время игры к расписанию
 *     description: Только для администратора. Удаляет отклонение от расписания.
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: hallId
 *         required: true
 *         schema: { type: string, enum: [hall1, hall2] }
 *       - in: path
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Время сброшено к расписанию
 *       403:
 *         description: Требуется вход администратора
 */
app.delete('/api/games/:hallId/:date/time', mutationLimiter, requireAdmin, async (req, res) => {
  const { hallId, date } = req.params;
  if (!isKnownHall(hallId) || !isValidDateStr(date)) {
    return res.status(400).json({ error: 'Неверный зал или дата' });
  }
  try {
    await pool.query(
      `UPDATE games
          SET start_time = NULL, end_time = NULL, time_note = NULL, time_changed_at = NULL
        WHERE hall_id = $1 AND date = $2`,
      [hallId, date]
    );
    const info = await getGameTime(hallId, date);
    res.json(info);
  } catch (err) {
    console.error('Ошибка сброса времени игры:', err);
    res.status(500).json({ error: 'Failed to reset game time' });
  }
});

/**
 * @swagger
 * /api/games/{hallId}/{date}/confirm:
 *   patch:
 *     summary: Подтвердить/снять подтверждение игры
 *     description: Только для администратора. Фиксирует снимок суммы на человека.
 *     tags: [Games]
 *     parameters:
 *       - in: path
 *         name: hallId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: date
 *         required: true
 *         schema: { type: string, format: date }
 *     responses:
 *       200:
 *         description: Состояние подтверждения
 *       403:
 *         description: Требуется вход администратора
 */
app.patch('/api/games/:hallId/:date/confirm', mutationLimiter, requireAdmin, async (req, res) => {
  const { hallId, date } = req.params;
  const confirmed = !!(req.body && req.body.confirmed);

  if (!isKnownHall(hallId) || !isValidDateStr(date)) {
    return res.status(400).json({ error: 'Неверный зал или дата' });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Текущее время игры (override или расписание) — для расчёта длительности.
      const info = await getGameTime(hallId, date);

      // Число записавшихся на эту игру.
      const cnt = await client.query(
        `SELECT COUNT(*)::int AS n
           FROM game_players gp
           JOIN games g ON gp.game_id = g.id
          WHERE g.hall_id = $1 AND g.date = $2`,
        [hallId, date]
      );
      const playersCount = cnt.rows[0] ? cnt.rows[0].n : 0;

      let price = null;
      if (confirmed) {
        price = computeConfirmedPrice(hallId, info.startTime, info.endTime, playersCount);
      }

      const duration = confirmed ? durationHours(info.startTime, info.endTime) : null;
      const upd = await client.query(
        `UPDATE games
            SET confirmed = $3,
                confirmed_at = CASE WHEN $3 THEN now() ELSE NULL END,
                confirmed_price = $4,
                confirmed_players = $5,
                confirmed_duration = $6
          WHERE hall_id = $1 AND date = $2`,
        [hallId, date, confirmed, price, confirmed ? playersCount : null, duration]
      );
      if (upd.rowCount === 0) {
        await client.query(
          `INSERT INTO games (hall_id, date, confirmed, confirmed_at, confirmed_price, confirmed_players, confirmed_duration)
            VALUES ($1, $2, $3, CASE WHEN $3 THEN now() ELSE NULL END, $4, $5, $6)`,
          [hallId, date, confirmed, price, confirmed ? playersCount : null, duration]
        );
      }

      await client.query('COMMIT');
    } catch (txErr) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw txErr;
    } finally {
      client.release();
    }

    const info = await getGameTime(hallId, date);
    res.json(info);
  } catch (err) {
    console.error('Ошибка подтверждения игры:', err);
    res.status(500).json({ error: 'Failed to confirm game' });
  }
});

// Swagger UI — документация API
const swaggerUi = require('swagger-ui-express');
const { swaggerSpec } = require('./swagger');
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'Ball76 API',
  customCssUrl: 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css'
}));

// Порт. Слушаем на 0.0.0.0 (все интерфейсы), чтобы:
// - работал локальный доступ (localhost)
// - работал Docker-порт-маппинг (контейнер → хост)
// - работал localtunnel-туннель (проксирует на localhost:8080)
const PORT = process.env.PORT || 8080;
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('✅ Server listening on http://localhost:' + PORT);
});

// Неубиваемые ошибки: логируем и продолжаем работать.
// Пул pg сам переподключается при обрывах; сетевые сбои не должны
// ронять весь сервер.
process.on('uncaughtException', (err) => {
  console.error('❌ Непредвиденная ошибка (сервер продолжает работу):', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection (сервер продолжает работу):', reason);
});

// Корректное завершение по SIGTERM/SIGINT (Railway, docker stop)
['SIGTERM', 'SIGINT'].forEach(signal => {
  process.on(signal, () => {
    console.log(`🛑 Получен ${signal}, закрываю сервер...`);
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
});