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
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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

// Порт
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log('✅ Server listening on port', PORT);
  console.log('📄 Файл данных:', DATA_FILE);
});
