const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();

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

// POST /api/players/:hallId — добавить игрока в зал (hall1 / hall2)
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

// DELETE /api/players/all/:hallId — очистить всех участников в зале
app.delete('/api/players/all/:hallId', (req, res) => {
  const { hallId } = req.params;

  console.log('➡️ DELETE /api/players/all/:hallId, hallId:', hallId);

  // 1. Проверка hallId
  if (!hallId || !['hall1', 'hall2'].includes(hallId)) {
    console.log('❌ DELETE /api/players/all/:hallId: invalid hallId -> 400');
    return res.status(400).json({
      error: 'Bad request: hallId must be "hall1" or "hall2"'
    });
  }

  // 2. Читаем файл
  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    if (err) {
      console.error('❌ Ошибка чтения players.json:', err.message);
      console.error('Stack:', err.stack);
      return res.status(500).json({ error: 'Failed to read players.json' });
    }

    try {
      const { playersByHall, historyByDate } = JSON.parse(data);

      // 3. Убедимся, что зал существует
      if (!playersByHall[hallId]) {
        console.log('⚠️ Зала', hallId, 'не было, создаём пустой массив');
        playersByHall[hallId] = [];
      }

      // 4. Очищаем всех игроков (аналог "удаление всех по индексу")
      playersByHall[hallId].length = 0;

      // 5. Сохраняем обратно
      const updatedData = JSON.stringify({ playersByHall, historyByDate }, null, 2);
      fs.writeFileSync(DATA_FILE, updatedData);

      console.log('✅ Очистка всех игроков в зале', hallId, 'успешна');
      res.json({ playersByHall });
    } catch (parseErr) {
      console.error('❌ Ошибка парсинга/записи players.json:', parseErr.message);
      console.error('Stack:', parseErr.stack);
      res.status(500).json({ error: 'Failed to update players.json' });
    }
  });
});



// Порт
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('✅ Server listening on port', PORT);
  console.log('📄 Файл данных:', DATA_FILE);
});
