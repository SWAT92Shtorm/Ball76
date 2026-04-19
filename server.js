// server.js
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

// === СОЗДАЁМ app ДО ВСЕХ app.use() ===
const app = express();

// Включаем CORS
app.use(cors({
  origin: [
    'https://swat92shtorm.github.io',
    'https://seleniumwebdriverdq-production.up.railway.app'
  ]
}));

// Важно: разрешить читать JSON из тела запроса
app.use(express.json());

// Путь к файлу с данными
const DATA_DIR = path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'players.json');

// Создать папку data, если её нет
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Создать players.json, если его нет
if (!fs.existsSync(DATA_FILE)) {
  const emptyData = {
    playersByHall: { hall1: [], hall2: [] },
    historyByDate: {}
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(emptyData, null, 2), 'utf8');
}

// Загрузка текущих данных (GET /api/players)
app.get('/api/players', (req, res) => {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    const json = JSON.parse(data);
    res.json(json);
  } catch (err) {
    console.error('Failed to read players.json:', err.message);
    res.status(500).json({ error: 'Failed to read players.json' });
  }
});

// Сохранение игроков и истории (POST /api/savePlayers)
app.post('/api/savePlayers', (req, res) => {
  const { playersByHall, historyByDate } = req.body;

  const data = {
    playersByHall: playersByHall || { hall1: [], hall2: [] },
    historyByDate: historyByDate || {}
  };

  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
    res.json({ success: true, message: 'Players saved' });
  } catch (err) {
    console.error('Failed to save players.json:', err.message);
    res.status(500).json({ error: 'Failed to save players.json' });
  }
});

// Важно для Railway: использовать PORT из переменной среды
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
