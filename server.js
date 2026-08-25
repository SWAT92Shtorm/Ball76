const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');

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
  })
  .catch(err => {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
  });

// CORS: разрешаем GitHub Pages (продакшен), туннели (localtunnel/zrok/cloudflared)
// и локальные origins (localhost/127.0.0.1). Туннельные домены меняются при
// каждом запуске — поэтому разрешаем целые зоны, а не конкретные поддомены.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isAllowed =
    origin === 'https://swat92shtorm.github.io' ||
    /\.loca\.lt$/.test(origin || '') ||          // localtunnel (основной туннель)
    /\.shares\.zrok\.io$/.test(origin || '') || // zrok (запасной)
    /\.trycloudflare\.com$/.test(origin || '') || // cloudflared quick tunnel
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin || '');

  if (isAllowed) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Парсинг JSON
app.use(express.json());

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

// PING-домашняя страница.
// Отдаёт API-пинг для curl/health-check и HTML-страницу для браузера
// (User-Agent содержит "Mozilla") — так туннельный адрес сразу
// показывает фронтенд, а не текст "Server works!".
/**
 * @swagger
 * /:
 *   get:
 *     summary: Пинг-проверка сервера / главная страница
 *     tags: [Status]
 *     responses:
 *       200:
 *         description: Сервер работает (text/plain для API-клиентов, html для браузеров)
 */
app.get('/', (req, res) => {
  const ua = req.headers['user-agent'] || '';
  if (/mozilla/i.test(ua)) {
    res.sendFile(path.join(__dirname, 'index.html'));
    return;
  }
  res.send('Server works!');
});

// Статика фронтенда (app.js, styles.css, ball.png, robots.txt, sitemap.xml):
// позволяет открыть сайт целиком через туннельный адрес, без GitHub Pages.
app.use(express.static(__dirname, { index: false }));

/**
 * @swagger
 * /api/config:
 *   get:
 *     summary: Получить конфигурацию приложения
 *     description: Возвращает единый конфиг для клиента: цены, телефоны, расписание, лимиты.
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
const APP_CONFIG = {
  maxPlayers: 18,
  halls: {
    hall1: {
      name: 'ЛОКОМОТИВ',
      phone: '+7 (961) 154-44-11',
      responsible: 'Андрей Дубровин',
      prices: { full: 6000, short: 4500 },
      schedule: [
        { day: 'Tuesday', from: 21, to: 23 },
        { day: 'Thursday', from: 21, to: 23 }
      ]
    },
    hall2: {
      name: 'АТЛАНТ',
      phone: '+7 (910) 979-22-99',
      responsible: 'Ярослав Волков',
      // Аренда всегда фиксированная 6000 ₽; в отличие от ЛОКОМОТИВ
      // сумма не делится на участников — каждый платит 300 ₽.
      prices: { full: 6000, short: 6000 },
      perPerson: 300,
      schedule: [
        { day: 'Friday', from: 21, to: 23 }
      ]
    }
  }
};

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

    const playersByHall = { hall1: [], hall2: [] };

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
 *                       value: Bad request: name, date, and hallId required
 *                     full:
 *                       value: Игра заполнена: максимум 18 человек
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

  if (!name || !date || !hallId || !['hall1', 'hall2'].includes(hallId)) {
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
app.patch('/api/player/name', mutationLimiter, async (req, res) => {
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

    const playersByHall = { hall1: [], hall2: [] };

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
        p.name
        FROM game_players gp
        JOIN players p ON gp.player_id = p.id
        JOIN games g ON gp.game_id = g.id
        ORDER BY g.date DESC, gp.created_at ASC, p.name;`
    );

    // собрать в структуру вида historyByDate[date][hallId] = [names...]
    const historyByDate = {};

    result.rows.forEach(row => {
      const hallId = row.hall_id;
      const date = formatDateMSK(row.date); // YYYY-MM-DD в московском времени
      const name = row.name.trim();

      if (!historyByDate[date]) {
        historyByDate[date] = {};
      }
      if (!historyByDate[date][hallId]) {
        historyByDate[date][hallId] = [];
      }

      if (!historyByDate[date][hallId].includes(name)) {
        historyByDate[date][hallId].push(name);
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
// - работал zrok-туннель (проксирует на localhost:8080)
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