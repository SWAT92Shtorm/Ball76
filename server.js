const express = require('express');

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

// CORS: разрешаем GitHub Pages (продакшен), zrok-туннель и локальные origins (localhost/127.0.0.1)
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isAllowed =
    origin === 'https://swat92shtorm.github.io' ||
    origin === 'https://ball76.shares.zrok.io' ||
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

// PING-домашняя страница
app.get('/', (req, res) => {
  res.send('Server works!');
});

// GET /api/config — единый конфиг для клиента (цены, телефоны, расписание, лимиты)
app.get('/api/config', (req, res) => {
  res.json(APP_CONFIG);
});

// GET /api/status — проверка соединения с БД.
// Клиент использует этот эндпоинт, чтобы показать предупреждение
// «запись пока невозможна», когда сервер не может подключиться к PostgreSQL.
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
      prices: { full: 0, short: 0 },
      schedule: [
        { day: 'Friday', from: 21, to: 23 }
      ]
    }
  }
};

// Лимит игроков на одну игру
const MAX_PLAYERS = APP_CONFIG.maxPlayers;

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

// GET /api/players — отдать данные из БД
app.get('/api/players', async (req, res) => {
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



// POST /api/players/:hallId — добавить участника в существующую/новую игру
app.post('/api/players/:hallId', async (req, res) => {
  const { hallId } = req.params;
  const { name, date } = req.body;

  console.log('1️⃣ addPlayer: name=' + name + ', date=' + date + ', hallId=' + hallId);

  if (!name || !date || !hallId || !['hall1', 'hall2'].includes(hallId)) {
    console.log('⚠️ Валидация не прошла');
    return res.status(400).json({
      error: 'Bad request: name, date, and hallId required'
    });
  }

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

// НОВЫЙ endpoint с датой
app.get('/api/players/:hallId/:date', async (req, res) => {
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

// PATCH /api/player/name — изменить ФИО игрока по имени
app.patch('/api/player/name', async (req, res) => {
  const { currentName, newName } = req.body;

  // Валидация
  if (!currentName || !newName) {
    return res.status(400).json({
      error: 'currentName и newName обязательны'
    });
  }

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


// Удалить игрока из конкретной игры (зал + дата)
app.delete('/api/players/:hallId/:date/:name', async (req, res) => {
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


// GET /api/history
app.get('/api/history', async (req, res) => {
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