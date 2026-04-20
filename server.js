const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

const { Client } = require('pg');

// Подключение к PostgreSQL в Railway (по DATABASE_URL)
const client = new Client({
  connectionString: process.env.DATABASE_URL
});

// попытаться подключиться при старте
client.connect()
  .then(() => {
    console.log('✅ Подключено к PostgreSQL');
  })
  .catch(err => {
    console.error('❌ Ошибка подключения к PostgreSQL:', err.message);
  });

// Путь к файлу data/players.json
const DATA_FILE = path.join(__dirname, 'data/players.json');

// Если файла не существует — создаём с пустыми данными
if (!fs.existsSync(DATA_FILE)) {
  console.log('data/players.json не найден, создаю...');
  const defaultData = {
    playersByHall: { hall1: [], hall2: [] },
    historyByDate: {}
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2));
}

// CORS, как у тебя
app.use((req, res, next) => {
  const allowedOrigin = 'https://swat92shtorm.github.io';
  const origin = req.headers.origin;
  if (origin === allowedOrigin) {
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

// GET /api/players — отдать данные
/*
app.get('/api/players', (req, res) => {
  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Ошибка чтения players.json:', err.message);
      return res.status(500).json({ error: 'Failed to read players.json' });
    }
    try {
      res.json(JSON.parse(data));
    } catch (parseErr) {
      console.error('Ошибка парсинга JSON:', parseErr.message);
      res.status(500).json({ error: 'Invalid JSON format' });
    }
  });
});
*/

// GET /api/players — отдать данные из БД, не из players.json
app.get('/api/players', async (req, res) => {
  try {
    const result = await client.query(
        `SELECT
                p.id,
                p.name,
                g.hall_id,
                MIN(g.date) AS first_game_date
            FROM players p
            JOIN game_players gp ON p.id = gp.player_id
            JOIN games g ON gp.game_id = g.id
            GROUP BY p.id, p.name, g.hall_id
            ORDER BY first_game_date ASC, p.name;`
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
      error: 'Failed to read players from database',
      db_error: err.message
    });
  }
});



// POST /api/players/:hallId — добавить игрока в зал (hall1 / hall2)
/*
app.post('/api/players/:hallId', (req, res) => {
  const { hallId } = req.params;
  const { name } = req.body;

  // Валидация
  if (!name || !hallId) {
    return res.status(400).json({ error: 'Bad request: name and hallId required' });
  }

  // Чтение players.json
  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Ошибка чтения players.json:', err.message);
      return res.status(500).json({ error: 'Failed to read players.json' });
    }

    try {
      const { playersByHall, historyByDate } = JSON.parse(data);

      // Если такого зала нет — создаём массив
      if (!playersByHall[hallId]) {
        playersByHall[hallId] = [];
      }

      // Добавляем игрока в нужный зал
      playersByHall[hallId].push(name);

      // Сохраняем обратно
      const updatedData = JSON.stringify({ playersByHall, historyByDate }, null, 2);
      fs.writeFileSync(DATA_FILE, updatedData);

      // Возвращаем обновлённый playersByHall
      res.json({ playersByHall });
    } catch (parseErr) {
      console.error('Ошибка парсинга/записи players.json:', parseErr.message);
      res.status(500).json({ error: 'Failed to update players.json' });
    }
  });
});
*/

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

  let game;
  let player;

  try {
    console.log('2️⃣ Добавляем/ищем игрока в players');
    const playerRes = await client.query(
      `INSERT INTO players (name)
       VALUES ($1)
       ON CONFLICT (name) DO NOTHING
       RETURNING *;`,
      [name]
    );

    if (playerRes.rows.length > 0) {
      player = playerRes.rows[0];
    } else {
      const selectPlayer = await client.query(
        'SELECT * FROM players WHERE name = $1;',
        [name]
      );
      player = selectPlayer.rows[0];
    }

    console.log('3️⃣ Игрок:', player);

    // 3. Найти или создать игру
    console.log('4️⃣ Ищем игру games WHERE hall_id = ' + hallId + ', date = ' + date);
    const findGame = await client.query(
      'SELECT * FROM games WHERE hall_id = $1 AND date = $2;',
      [hallId, date]
    );

    if (findGame.rows.length > 0) {
      game = findGame.rows[0];
      console.log('5️⃣ Игра найдена:', game.id);
    } else {
      console.log('6️⃣ Создаём новую игру');
      const createGame = await client.query(
        `INSERT INTO games (hall_id, date)
         VALUES ($1, $2)
         RETURNING *;`,
        [hallId, date]
      );
      game = createGame.rows[0];
      console.log('7️⃣ Новая игра создана:', game.id);
    }

    // 4. Связываем игрока с игрой
    console.log('8️⃣ Проверяем, записан ли игрок уже на эту игру');
    const existing = await client.query(
      'SELECT * FROM game_players WHERE game_id = $1 AND player_id = $2;',
      [game.id, player.id]
    );

    if (existing.rows.length > 0) {
      console.log('9️⃣ Игрок уже записан');
      return res.status(400).json({
        error: 'Игрок уже записан на эту игру'
      });
    }

    console.log('10️⃣ Добавляем в game_players');
    await client.query(
      `INSERT INTO game_players (game_id, player_id)
       VALUES ($1, $2);`,
      [game.id, player.id]
    );

    // 5. Возвращаем список игроков игры
    console.log('11️⃣ Читаем всех игроков игры');
    const gamePlayers = await client.query(
        `SELECT
            p.name
        FROM game_players gp
        JOIN players p ON gp.player_id = p.id
        JOIN games g ON gp.game_id = g.id
        WHERE gp.game_id = $1
        ORDER BY g.date ASC, p.name;`,
        [game.id]
    );

    const players = gamePlayers.rows.map(r => r.name);

    console.log('12️⃣ Отправляем ответ:', players);

    res.json({
      playersByHall: { [hallId]: players }
    });
  } catch (err) {
    console.error('❌ Ошибка записи игрока:', err);
    res.status(500).json({
      error: 'Failed to register player',
      db_error: err.message
    });
  }
});



// PATCH /api/players/:hallId/:playerIndex — изменить игрока
app.patch('/api/players/:hallId/:playerIndex', (req, res) => {
  const { hallId, playerIndex } = req.params;
  const { name } = req.body;

  // Валидация
  if (!name || !hallId || isNaN(playerIndex)) {
    return res.status(400).json({ error: 'Bad request' });
  }

  const index = parseInt(playerIndex, 10);

  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Ошибка чтения players.json:', err.message);
      return res.status(500).json({ error: 'Failed to read players.json' });
    }

    try {
      const { playersByHall, historyByDate } = JSON.parse(data);

      if (!playersByHall[hallId]) {
        return res.status(400).json({ error: `Нет зала: ${hallId}` });
      }

      if (index < 0 || index >= playersByHall[hallId].length) {
        return res.status(400).json({ error: 'Неверный индекс игрока' });
      }

      playersByHall[hallId][index] = name;

      const updatedData = JSON.stringify({ playersByHall, historyByDate }, null, 2);
      fs.writeFileSync(DATA_FILE, updatedData);

      res.json({ playersByHall });
    } catch (parseErr) {
      console.error('Ошибка парсинга/записи players.json:', parseErr.message);
      res.status(500).json({ error: 'Failed to update players.json' });
    }
  });
});

// DELETE /api/players/:hallId/:playerIndex — удалить игрока
/*
app.delete('/api/players/:hallId/:playerIndex', (req, res) => {
  const { hallId, playerIndex } = req.params;

  if (!hallId || isNaN(playerIndex)) {
    return res.status(400).json({ error: 'Bad request' });
  }

  const index = parseInt(playerIndex, 10);

  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Ошибка чтения players.json:', err.message);
      return res.status(500).json({ error: 'Failed to read players.json' });
    }

    try {
      const { playersByHall, historyByDate } = JSON.parse(data);

      if (!playersByHall[hallId]) {
        return res.status(400).json({ error: `Нет зала: ${hallId}` });
      }

      if (index < 0 || index >= playersByHall[hallId].length) {
        return res.status(400).json({ error: 'Неверный индекс игрока' });
      }

      playersByHall[hallId].splice(index, 1);

      const updatedData = JSON.stringify({ playersByHall, historyByDate }, null, 2);
      fs.writeFileSync(DATA_FILE, updatedData);

      res.json({ playersByHall });
    } catch (parseErr) {
      console.error('Ошибка парсинга/записи players.json:', parseErr.message);
      res.status(500).json({ error: 'Failed to update players.json' });
    }
  });
});
*/

// Удалить игрока из конкретной игры (зал + дата)
app.delete('/api/players/:hallId/:date/:name', async (req, res) => {
  const { hallId, date, name } = req.params;

  try {
    // найти game_id по hall_id и date
    const gameResult = await client.query(
      `SELECT id FROM games WHERE hall_id = $1 AND date = $2`,
      [hallId, date]
    );
    if (gameResult.rows.length === 0) {
      return res.status(404).json({ error: 'Игра не найдена' });
    }
    const gameId = gameResult.rows[0].id;

    // найти playerId по имени
    const playerResult = await client.query(
      `SELECT id FROM players WHERE name = $1`,
      [name]
    );
    if (playerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Игрок не найден' });
    }
    const playerId = playerResult.rows[0].id;

    // удаляем связь из game_players
    const deleteResult = await client.query(
      `DELETE FROM game_players
       WHERE player_id = $1 AND game_id = $2`,
      [playerId, gameId]
    );

    // вернуть обновлённый список игроков этой игры
    const updatedResult = await client.query(
      `SELECT p.name
       FROM game_players gp
       JOIN players p ON gp.player_id = p.id
       JOIN games g ON gp.game_id = g.id
       WHERE g.hall_id = $1 AND g.date = $2
       ORDER BY p.name`,
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


// POST /api/games/confirm — подтвердить игру и сохранить в историю
app.post('/api/games/confirm', (req, res) => {
  const { hallId, date, players } = req.body;

  if (!hallId || !date || !Array.isArray(players)) {
    return res.status(400).json({ error: 'Bad request' });
  }

  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Ошибка чтения players.json:', err.message);
      return res.status(500).json({ error: 'Failed to read players.json' });
    }

    try {
      const { playersByHall, historyByDate } = JSON.parse(data);

      if (!historyByDate[date]) {
        historyByDate[date] = {};
      }

      historyByDate[date][hallId] = [...players]; // делаем копию массива

      const updatedData = JSON.stringify({ playersByHall, historyByDate }, null, 2);
      fs.writeFileSync(DATA_FILE, updatedData);

      res.json({ historyByDate });
    } catch (parseErr) {
      console.error('Ошибка парсинга/записи players.json:', parseErr.message);
      res.status(500).json({ error: 'Failed to update players.json' });
    }
  });
});

// POST /api/players/sync/:hallId — сохранить список игроков целиком (включая пустой массив)
app.post('/api/players/sync/:hallId', (req, res) => {
  const { hallId } = req.params;
  const { players } = req.body;

  console.log('POST /api/players/sync/:hallId, hallId:', hallId);
  console.log('players:', players);

  // проверка hallId
  if (!hallId || !['hall1', 'hall2'].includes(hallId)) {
    console.log('ERROR: invalid hallId -> 400');
    return res.status(400).json({
      error: 'Bad request: invalid hallId, allowed: hall1, hall2'
    });
  }

  // проверка players
  if (!Array.isArray(players)) {
    console.log('ERROR: players must be array -> 400');
    return res.status(400).json({ error: 'Bad request: players must be an array' });
  }

  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('Ошибка чтения players.json:', err.message);
      return res.status(500).json({ error: 'Failed to read players.json' });
    }

    try {
      const { playersByHall, historyByDate } = JSON.parse(data);

      // обновляем весь список игроков в этом зале (включая пустой массив)
      playersByHall[hallId] = players;

      const updatedData = JSON.stringify({ playersByHall, historyByDate }, null, 2);
      fs.writeFileSync(DATA_FILE, updatedData);

      console.log('Синхронизация игроков в зале', hallId, 'успешна');

      res.json({ playersByHall });
    } catch (parseErr) {
      console.error('Ошибка парсинга/записи players.json:', parseErr.message);
      res.status(500).json({ error: 'Failed to update players.json' });
    }
  });
});

// GET /api/history
app.get('/api/history', async (req, res) => {
  try {
    // запрос: получить все игры и привязанных к ним игроков
    const result = await client.query(
      `SELECT
         g.hall_id,
         g.date,
         p.name
       FROM game_players gp
       JOIN players p ON gp.player_id = p.id
       JOIN games g ON gp.game_id = g.id
       ORDER BY g.date DESC, g.hall_id, p.name;`
    );

    // собрать в структуру вида historyByDate[date][hallId] = [names...]
    const historyByDate = {};

    result.rows.forEach(row => {
      const hallId = row.hall_id;
      const date = row.date.toISOString().split('T')[0]; // YYYY-MM-DD
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
      error: 'Failed to read history',
      db_error: err.message
    });
  }
});

// Порт
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('✅ Server listening on port', PORT);
  console.log('📄 Файл данных:', DATA_FILE);
});